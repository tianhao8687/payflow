import {
  PaymentStatus,
  PaymentProvider as DatabasePaymentProvider,
  Prisma,
  ReconciliationIssueStatus,
  ReconciliationIssueType,
  ReconciliationRunStatus,
  RefundStatus,
  type PrismaClient,
} from '@payflow/database';
import {
  PaymentProviderCapability,
  PaymentProviderRegistry,
  type ProviderPayment,
  ProviderPaymentStatus,
} from '@payflow/payment-core';
import {
  recordReconciliationIssue,
  SpanKind,
  withSpan,
} from '@payflow/observability';

export interface ReconciliationWindow {
  limit?: number;
  windowEnd: Date;
  windowStart: Date;
}

export interface ReconciliationRunResult {
  checkedCount: number;
  errorCount: number;
  id: string;
  issueCount: number;
  passedCount: number;
  status: ReconciliationRunStatus;
}

interface LocalPaymentSnapshot {
  amount: number;
  currency: string;
  paymentId: string;
  providerPaymentId: string | null;
  refundedAmount: number;
  status: ProviderPaymentStatus;
}

interface ProviderPaymentSnapshot {
  amount: number;
  currency: string;
  providerPaymentId: string | null;
  providerRequestId: string | null;
  refundedAmount: number | null;
  status: ProviderPaymentStatus;
}

interface ReconciliationPayment {
  amount: number;
  currency: string;
  id: string;
  provider: DatabasePaymentProvider;
  providerCheckoutSessionId: string | null;
  providerPaymentId: string | null;
  refunds: Array<{ amount: number }>;
  status: PaymentStatus;
  updatedAt: Date;
}

export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  async run(window: ReconciliationWindow): Promise<ReconciliationRunResult> {
    assertWindow(window);
    const run = await this.prisma.reconciliationRun.create({
      data: {
        windowEnd: window.windowEnd,
        windowStart: window.windowStart,
      },
      select: { id: true },
    });
    const counts = {
      checkedCount: 0,
      errorCount: 0,
      issueCount: 0,
      passedCount: 0,
    };

    try {
      const pageSize = Math.min(Math.max(window.limit ?? 250, 1), 500);
      let cursor: { id: string; updatedAt: Date } | null = null;
      let pageCount = 0;
      while (true) {
        const payments: ReconciliationPayment[] =
          await this.prisma.payment.findMany({
            where: {
              updatedAt: { gte: window.windowStart, lt: window.windowEnd },
              ...(cursor
                ? {
                    OR: [
                      { updatedAt: { gt: cursor.updatedAt } },
                      { id: { gt: cursor.id }, updatedAt: cursor.updatedAt },
                    ],
                  }
                : {}),
            },
            include: {
              refunds: {
                where: { status: RefundStatus.SUCCEEDED },
                select: { amount: true },
              },
            },
            orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
            take: pageSize,
          });
        if (payments.length === 0) {
          break;
        }
        const results = await mapWithConcurrency(payments, 4, (payment) =>
          this.reconcilePayment(run.id, payment),
        );
        for (const result of results) {
          counts.checkedCount += 1;
          counts.errorCount += result.errorCount;
          counts.issueCount += result.issueCount;
          counts.passedCount += result.passedCount;
        }
        const last: ReconciliationPayment = payments.at(-1)!;
        cursor = { id: last.id, updatedAt: last.updatedAt };
        pageCount += 1;
        await this.prisma.reconciliationRun.update({
          where: { id: run.id },
          data: {
            checkpointPaymentId: cursor.id,
            checkpointUpdatedAt: cursor.updatedAt,
            pageCount,
          },
        });
      }

      return this.complete(run.id, counts);
    } catch (error: unknown) {
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: {
          ...counts,
          completedAt: new Date(),
          errorCount: counts.errorCount + 1,
          status: ReconciliationRunStatus.COMPLETED_WITH_ERRORS,
        },
      });
      throw error;
    }
  }

  private async reconcilePayment(
    runId: string,
    payment: ReconciliationPayment,
  ): Promise<{
    errorCount: number;
    issueCount: number;
    passedCount: number;
  }> {
    const local = localSnapshot(payment);
    let providerPayment: ProviderPayment;
    try {
      const provider = this.providers.require(payment.provider);
      if (!provider.isConfigured(PaymentProviderCapability.PAYMENT)) {
        throw new Error(
          `${payment.provider} is not configured for reconciliation lookups.`,
        );
      }
      providerPayment = await withSpan(
        'provider.payment.reconcile',
        {
          attributes: {
            'payment.provider': payment.provider,
            'payflow.payment.id': payment.id,
          },
          kind: SpanKind.CLIENT,
        },
        () => {
          if (provider.getPaymentByReference) {
            return provider.getPaymentByReference({
              amount: payment.amount,
              currency: payment.currency,
              merchantReference: payment.id,
              providerCheckoutSessionId: payment.providerCheckoutSessionId,
              providerPaymentId: payment.providerPaymentId,
            });
          }
          if (!payment.providerPaymentId) {
            throw new Error(
              `${payment.provider} has no queryable payment reference.`,
            );
          }
          return provider.getPayment(payment.providerPaymentId);
        },
      );
    } catch (error: unknown) {
      await this.prisma.reconciliationCheck.create({
        data: {
          error: errorMessage(error).slice(0, 500),
          localSnapshot: json(local),
          matched: false,
          paymentId: payment.id,
          provider: payment.provider,
          providerSnapshot: Prisma.JsonNull,
          runId,
        },
      });
      return { errorCount: 1, issueCount: 0, passedCount: 0 };
    }

    const remote = providerSnapshot(providerPayment);
    const issueTypes = differences(local, remote);
    const check = await this.prisma.reconciliationCheck.create({
      data: {
        localSnapshot: json(local),
        matched: issueTypes.length === 0,
        paymentId: payment.id,
        provider: payment.provider,
        providerSnapshot: json(remote),
        runId,
      },
      select: { id: true },
    });
    for (const issueType of issueTypes) {
      const created = await this.recordIssue({
        checkId: check.id,
        issueType,
        local,
        paymentId: payment.id,
        provider: payment.provider,
        remote,
        runId,
      });
      if (created) {
        recordReconciliationIssue({
          issue_type: issueType,
          provider: payment.provider,
        });
      }
    }
    return {
      errorCount: 0,
      issueCount: issueTypes.length,
      passedCount: issueTypes.length === 0 ? 1 : 0,
    };
  }

  private async complete(
    runId: string,
    counts: {
      checkedCount: number;
      errorCount: number;
      issueCount: number;
      passedCount: number;
    },
  ): Promise<ReconciliationRunResult> {
    const status =
      counts.errorCount === 0
        ? ReconciliationRunStatus.COMPLETED
        : ReconciliationRunStatus.COMPLETED_WITH_ERRORS;
    const completed = await this.prisma.reconciliationRun.update({
      where: { id: runId },
      data: { ...counts, completedAt: new Date(), status },
    });
    return {
      checkedCount: completed.checkedCount,
      errorCount: completed.errorCount,
      id: completed.id,
      issueCount: completed.issueCount,
      passedCount: completed.passedCount,
      status: completed.status,
    };
  }

  private async recordIssue(input: {
    checkId: string;
    issueType: ReconciliationIssueType;
    local: LocalPaymentSnapshot;
    paymentId: string;
    provider: DatabasePaymentProvider;
    remote: ProviderPaymentSnapshot;
    runId: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT 1::integer AS acquired
          FROM pg_advisory_xact_lock(hashtextextended(${`reconciliation:${input.paymentId}:${input.issueType}`}, 0))`,
      );
      const existing = await transaction.reconciliationIssue.findFirst({
        where: {
          issueType: input.issueType,
          paymentId: input.paymentId,
          status: ReconciliationIssueStatus.OPEN,
        },
        select: { id: true },
      });
      const snapshots = {
        checkId: input.checkId,
        lastSeenAt: new Date(),
        localSnapshot: json(input.local),
        providerSnapshot: json(input.remote),
        runId: input.runId,
      };

      if (existing) {
        await transaction.reconciliationIssue.update({
          where: { id: existing.id },
          data: snapshots,
        });
        return false;
      }

      const created = await transaction.reconciliationIssue.create({
        data: {
          ...snapshots,
          issueType: input.issueType,
          paymentId: input.paymentId,
          provider: input.provider,
        },
        select: { id: true },
      });
      await transaction.auditLog.create({
        data: {
          action: 'RECONCILIATION_ISSUE_DETECTED',
          actorType: 'SYSTEM',
          metadataJson: {
            issueType: input.issueType,
            paymentId: input.paymentId,
            provider: input.provider,
            runId: input.runId,
          },
          targetId: created.id,
          targetType: 'RECONCILIATION_ISSUE',
        },
      });
      return true;
    });
  }
}

function localSnapshot(payment: {
  amount: number;
  currency: string;
  id: string;
  providerPaymentId: string | null;
  refunds: Array<{ amount: number }>;
  status: PaymentStatus;
}): LocalPaymentSnapshot {
  return {
    amount: payment.amount,
    currency: payment.currency,
    paymentId: payment.id,
    providerPaymentId: payment.providerPaymentId,
    refundedAmount: payment.refunds.reduce(
      (sum, refund) => sum + refund.amount,
      0,
    ),
    status: providerStatus(payment.status),
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= values.length) {
          return;
        }
        results[index] = await mapper(values[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function providerSnapshot(payment: ProviderPayment): ProviderPaymentSnapshot {
  return {
    amount: payment.amount,
    currency: payment.currency,
    providerPaymentId: payment.providerPaymentId,
    providerRequestId: payment.providerRequestId,
    refundedAmount: payment.refundedAmount,
    status: payment.status,
  };
}

function differences(
  local: LocalPaymentSnapshot,
  remote: ProviderPaymentSnapshot,
): ReconciliationIssueType[] {
  const issues: ReconciliationIssueType[] = [];
  if (local.amount !== remote.amount) {
    issues.push(ReconciliationIssueType.AMOUNT_MISMATCH);
  }
  if (local.currency !== remote.currency) {
    issues.push(ReconciliationIssueType.CURRENCY_MISMATCH);
  }
  if (local.status !== remote.status) {
    issues.push(ReconciliationIssueType.STATUS_MISMATCH);
  }
  if (
    remote.refundedAmount !== null &&
    local.refundedAmount !== remote.refundedAmount
  ) {
    issues.push(ReconciliationIssueType.REFUND_TOTAL_MISMATCH);
  }
  return issues;
}

function providerStatus(status: PaymentStatus): ProviderPaymentStatus {
  switch (status) {
    case PaymentStatus.CREATED:
    case PaymentStatus.PENDING:
      return ProviderPaymentStatus.PENDING;
    case PaymentStatus.PROCESSING:
      return ProviderPaymentStatus.PROCESSING;
    case PaymentStatus.SUCCEEDED:
    case PaymentStatus.PARTIALLY_REFUNDED:
    case PaymentStatus.REFUNDED:
      return ProviderPaymentStatus.SUCCEEDED;
    case PaymentStatus.FAILED:
      return ProviderPaymentStatus.FAILED;
  }
}

function assertWindow(window: ReconciliationWindow): void {
  if (
    Number.isNaN(window.windowStart.getTime()) ||
    Number.isNaN(window.windowEnd.getTime()) ||
    window.windowStart >= window.windowEnd
  ) {
    throw new Error('Reconciliation window start must be before its end.');
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unknown reconciliation provider error.';
}
