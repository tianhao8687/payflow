import { createHash } from 'node:crypto';

import {
  AuditActorType,
  OrderStatus,
  PaymentProvider as DatabasePaymentProvider,
  PaymentStatus,
  Prisma,
  type PrismaClient,
  RefundStatus,
  WebhookEventStatus,
} from '@payflow/database';
import {
  type PaymentProvider,
  PaymentProviderError,
  PaymentProviderRegistry,
  type ProviderPaymentTransitionAction,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  type ProviderWebhookAction,
  type VerifiedWebhookEvent,
} from '@payflow/payment-core';

import { applyProviderRefundSnapshot } from './refund-projection';
import { appendPaymentSucceededEvent } from './outbox';
import {
  InvalidOrderTransitionError,
  InvalidPaymentTransitionError,
  assertOrderTransition,
  assertPaymentTransition,
} from './state-machines';

export interface WebhookReceipt {
  duplicate: boolean;
  enqueue: boolean;
  eventId: string;
  status: WebhookEventStatus;
}

export interface UndispatchedWebhookEvent {
  id: string;
  provider: DatabasePaymentProvider;
  receivedAt: Date;
}

export interface InboxDispatchFailureSchedule {
  nextDispatchAt: Date;
  retryDelayMs: number;
}

export interface WebhookProcessingResult {
  correlation: WebhookCorrelation;
  status: WebhookEventStatus;
  transition: WebhookTransition | null;
}

export interface WebhookCorrelation {
  orderId?: string;
  paymentId?: string;
  provider: DatabasePaymentProvider;
  providerEventId: string;
  refundId?: string;
  webhookEventId: string;
}

export interface WebhookTransition {
  changed: boolean;
  kind: 'PAYMENT' | 'REFUND';
  status: string;
}

interface WebhookActionResult {
  processingError: string | null;
  status: WebhookEventStatus;
  transition: WebhookTransition | null;
}

type ResolvedPaymentTransitionAction = ProviderPaymentTransitionAction & {
  orderId: string;
  paymentId: string;
};

export class WebhookEventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async receive(event: VerifiedWebhookEvent): Promise<WebhookReceipt> {
    const provider = databaseProvider(event.provider);
    const eventLockKey = `${provider}:${event.providerEventId}`;
    const eventFingerprint = webhookEventFingerprint({
      eventType: event.eventType,
      payload: event.payload,
      provider,
      providerEventId: event.providerEventId,
    });

    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT 1::integer AS acquired
            FROM pg_advisory_xact_lock(hashtextextended(${eventLockKey}, 0))`,
        );
        const existing = await transaction.webhookEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider,
              providerEventId: event.providerEventId,
            },
          },
          select: {
            eventFingerprint: true,
            eventType: true,
            id: true,
            payloadJson: true,
            queuedAt: true,
            status: true,
          },
        });

        if (existing) {
          const storedFingerprint =
            existing.eventFingerprint ??
            webhookEventFingerprint({
              eventType: existing.eventType,
              payload: existing.payloadJson,
              provider,
              providerEventId: event.providerEventId,
            });
          if (storedFingerprint !== eventFingerprint) {
            throw new WebhookEventConflictError(
              provider,
              event.providerEventId,
            );
          }
          const updated = await transaction.webhookEvent.update({
            where: { id: existing.id },
            data: {
              deliveryCount: { increment: 1 },
              eventFingerprint: storedFingerprint,
              lastReceivedAt: new Date(),
            },
            select: { id: true, queuedAt: true, status: true },
          });
          return {
            duplicate: true,
            enqueue:
              updated.status === WebhookEventStatus.RECEIVED &&
              updated.queuedAt === null,
            eventId: updated.id,
            status: updated.status,
          };
        }

        const created = await transaction.webhookEvent.create({
          data: {
            actionJson: json(event.action),
            eventFingerprint,
            eventType: event.eventType,
            payloadJson: json(event.payload),
            payloadHash: event.payloadHash,
            provider,
            providerEventId: event.providerEventId,
            providerOccurredAt: event.occurredAt,
          },
          select: { id: true, status: true },
        });

        return {
          duplicate: false,
          enqueue: true,
          eventId: created.id,
          status: created.status,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async markQueued(eventId: string, queueJobId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        dispatchError: null,
        dispatchLeaseUntil: null,
        queueJobId,
        queuedAt: new Date(),
      },
    });
  }

  listUndispatched(limit = 50): Promise<UndispatchedWebhookEvent[]> {
    const now = new Date();
    return this.prisma.webhookEvent.findMany({
      where: {
        nextDispatchAt: { lte: now },
        queuedAt: null,
        status: WebhookEventStatus.RECEIVED,
        OR: [{ dispatchLeaseUntil: null }, { dispatchLeaseUntil: { lt: now } }],
      },
      orderBy: [
        { nextDispatchAt: 'asc' },
        { receivedAt: 'asc' },
        { id: 'asc' },
      ],
      take: Math.min(Math.max(limit, 1), 200),
      select: { id: true, provider: true, receivedAt: true },
    });
  }

  async beginDispatchAttempt(eventId: string): Promise<number | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + 30_000);
    const claimed = await this.prisma.$queryRaw<
      Array<{ attemptNumber: number }>
    >(Prisma.sql`
      UPDATE "webhook_events"
      SET
        "dispatch_attempts" = "dispatch_attempts" + 1,
        "dispatch_lease_until" = ${leaseUntil},
        "last_dispatch_attempt_at" = ${now}
      WHERE "id" = CAST(${eventId} AS UUID)
        AND "queued_at" IS NULL
        AND "status" = CAST(${WebhookEventStatus.RECEIVED} AS "WebhookEventStatus")
        AND "next_dispatch_at" <= ${now}
        AND (
          "dispatch_lease_until" IS NULL
          OR "dispatch_lease_until" < ${now}
        )
      RETURNING "dispatch_attempts" AS "attemptNumber"
    `);
    return claimed[0]?.attemptNumber ?? null;
  }

  async recordDispatchFailure(
    eventId: string,
    attemptNumber: number,
    error: unknown,
  ): Promise<InboxDispatchFailureSchedule | null> {
    const now = new Date();
    const retryDelayMs = inboxDispatchRetryDelayMs(eventId, attemptNumber);
    const nextDispatchAt = new Date(now.getTime() + retryDelayMs);
    const updated = await this.prisma.webhookEvent.updateMany({
      where: {
        dispatchAttempts: attemptNumber,
        id: eventId,
        queuedAt: null,
        status: WebhookEventStatus.RECEIVED,
      },
      data: {
        dispatchError: errorMessage(error).slice(0, 500),
        dispatchLeaseUntil: null,
        nextDispatchAt,
      },
    });
    return updated.count === 1 ? { nextDispatchAt, retryDelayMs } : null;
  }

  async beginAttempt(eventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        lastProcessingStartedAt: new Date(),
        processingAttempts: { increment: 1 },
      },
    });
  }

  async recordAttemptFailure(
    eventId: string,
    error: unknown,
    final: boolean,
  ): Promise<void> {
    const message = errorMessage(error).slice(0, 500);
    await this.prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        processedAt: final ? new Date() : null,
        processingError: message,
        status: final ? WebhookEventStatus.FAILED : WebhookEventStatus.RECEIVED,
      },
    });
  }

  async process(
    eventId: string,
    providers: PaymentProviderRegistry,
  ): Promise<WebhookProcessingResult> {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: eventId },
      select: {
        actionJson: true,
        provider: true,
        providerEventId: true,
        status: true,
      },
    });

    if (!event) {
      throw new PermanentWebhookError(
        'The queued webhook event does not exist.',
      );
    }
    let action = parseAction(event.actionJson);
    const correlation = actionCorrelation(
      eventId,
      event.provider,
      event.providerEventId,
      action,
    );
    if (event.status !== WebhookEventStatus.RECEIVED) {
      return { correlation, status: event.status, transition: null };
    }

    if (action.kind === 'CAPTURE_PAYMENT') {
      action = await this.captureApprovedPayment(
        event.provider,
        action,
        providers.require(event.provider),
      );
    }

    if (action.kind === 'PAYMENT_TRANSITION') {
      action = await this.resolvePaymentTransition(event.provider, action);
    }

    return this.applyAction(
      eventId,
      event.provider,
      event.providerEventId,
      action,
    );
  }

  private async captureApprovedPayment(
    providerName: DatabasePaymentProvider,
    action: Extract<ProviderWebhookAction, { kind: 'CAPTURE_PAYMENT' }>,
    provider: PaymentProvider,
  ): Promise<ProviderPaymentTransitionAction> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: action.paymentId },
    });

    if (
      !payment ||
      payment.provider !== providerName ||
      payment.orderId !== action.orderId ||
      payment.providerCheckoutSessionId !== action.providerCheckoutSessionId
    ) {
      throw new PermanentWebhookError(
        'PayPal approval identifiers do not match the local payment.',
      );
    }

    if (
      payment.status === PaymentStatus.SUCCEEDED &&
      payment.providerPaymentId
    ) {
      return {
        amount: payment.amount,
        currency: payment.currency,
        kind: 'PAYMENT_TRANSITION',
        merchantReference: payment.id,
        orderId: payment.orderId,
        paymentId: payment.id,
        providerCheckoutSessionId: payment.providerCheckoutSessionId,
        providerPaymentId: payment.providerPaymentId,
        targetStatus: ProviderPaymentStatus.SUCCEEDED,
      };
    }

    if (!provider.capturePayment) {
      throw new PermanentWebhookError(
        `${provider.name} does not support server-side capture.`,
      );
    }

    const capture = await provider.capturePayment({
      idempotencyKey: `payment:capture:${payment.id}`,
      providerPaymentId: action.providerCheckoutSessionId,
    });
    const targetStatus = captureTarget(capture.status);

    return {
      amount: capture.amount,
      currency: capture.currency,
      kind: 'PAYMENT_TRANSITION',
      merchantReference: payment.id,
      orderId: payment.orderId,
      paymentId: payment.id,
      providerCheckoutSessionId: payment.providerCheckoutSessionId,
      providerPaymentId: capture.providerPaymentId,
      targetStatus,
    };
  }

  private async resolvePaymentTransition(
    provider: DatabasePaymentProvider,
    action: ProviderPaymentTransitionAction,
  ): Promise<ResolvedPaymentTransitionAction> {
    if (action.orderId && action.paymentId) {
      return action as ResolvedPaymentTransitionAction;
    }
    if (!action.merchantReference) {
      throw new PermanentWebhookError(
        'Payment transition has no local or merchant reference.',
      );
    }
    const payment = await this.prisma.payment.findFirst({
      where: { id: action.merchantReference, provider },
      select: { id: true, orderId: true },
    });
    if (!payment) {
      throw new PermanentWebhookError(
        'Merchant payment reference does not match a local payment.',
      );
    }
    return {
      ...action,
      orderId: payment.orderId,
      paymentId: payment.id,
    };
  }

  private async applyAction(
    eventId: string,
    provider: DatabasePaymentProvider,
    providerEventId: string,
    action: ProviderWebhookAction,
  ): Promise<WebhookProcessingResult> {
    const result = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT 1::integer AS acquired
            FROM pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`,
        );
        const current = await transaction.webhookEvent.findUniqueOrThrow({
          where: { id: eventId },
          select: { providerEventId: true, status: true },
        });
        if (current.status !== WebhookEventStatus.RECEIVED) {
          return {
            processingError: null,
            status: current.status,
            transition: null,
          };
        }

        let result: WebhookActionResult;
        if (action.kind === 'IGNORE') {
          result = {
            processingError: action.reason,
            status: WebhookEventStatus.IGNORED,
            transition: null,
          };
        } else if (action.kind === 'REJECT') {
          result = {
            processingError: action.reason,
            status: WebhookEventStatus.FAILED,
            transition: null,
          };
        } else if (action.kind === 'REFUND_SYNC') {
          result = await this.processRefund(
            transaction,
            current.providerEventId,
            action,
          );
        } else if (action.kind === 'PAYMENT_TRANSITION') {
          result = await this.processPaymentTransition(
            transaction,
            provider,
            resolvedPaymentAction(action),
          );
        } else {
          throw new PermanentWebhookError(
            'Capture action was not resolved before persistence.',
          );
        }

        await transaction.webhookEvent.update({
          where: { id: eventId },
          data: {
            processedAt: new Date(),
            processingError: result.processingError,
            status: result.status,
          },
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    return {
      correlation: actionCorrelation(
        eventId,
        provider,
        providerEventId,
        action,
      ),
      status: result.status,
      transition: result.transition,
    };
  }

  private async processRefund(
    transaction: Prisma.TransactionClient,
    providerEventId: string,
    action: Extract<ProviderWebhookAction, { kind: 'REFUND_SYNC' }>,
  ): Promise<WebhookActionResult> {
    const localStatus = localRefundStatus(action.status);
    const projection = await applyProviderRefundSnapshot(
      transaction,
      action.refundId,
      { ...action, status: localStatus },
    );

    if (!projection.error && !projection.stale) {
      await transaction.auditLog.create({
        data: {
          action: `REFUND_WEBHOOK_${localStatus}`,
          actorType: AuditActorType.SYSTEM,
          metadataJson: {
            providerEventId,
            providerRefundId: action.providerRefundId,
          },
          targetId: action.refundId,
          targetType: 'REFUND',
        },
      });
    }

    return projection.error
      ? {
          processingError: projection.error,
          status: WebhookEventStatus.FAILED,
          transition: null,
        }
      : projection.stale
        ? {
            processingError:
              'The refund event would regress a terminal local state.',
            status: WebhookEventStatus.IGNORED,
            transition: null,
          }
        : {
            processingError: null,
            status: WebhookEventStatus.PROCESSED,
            transition: {
              changed: projection.changed,
              kind: 'REFUND',
              status: localStatus,
            },
          };
  }

  private async processPaymentTransition(
    transaction: Prisma.TransactionClient,
    provider: DatabasePaymentProvider,
    action: ResolvedPaymentTransitionAction,
  ): Promise<WebhookActionResult> {
    const targetStatus = localPaymentStatus(action.targetStatus);
    await transaction.$queryRaw(
      Prisma.sql`SELECT 1::integer AS acquired
        FROM pg_advisory_xact_lock(hashtextextended(${action.orderId}, 0))`,
    );
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "orders"
        WHERE "id" = CAST(${action.orderId} AS UUID) FOR UPDATE`,
    );
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "payments"
        WHERE "id" = CAST(${action.paymentId} AS UUID) FOR UPDATE`,
    );

    const payment = await transaction.payment.findUnique({
      where: { id: action.paymentId },
      include: { order: true },
    });
    if (
      !payment ||
      payment.provider !== provider ||
      payment.orderId !== action.orderId ||
      action.amount !== payment.amount ||
      action.currency !== payment.currency ||
      (action.providerCheckoutSessionId !== null &&
        action.providerCheckoutSessionId !==
          payment.providerCheckoutSessionId) ||
      (payment.providerPaymentId !== null &&
        action.providerPaymentId !== null &&
        payment.providerPaymentId !== action.providerPaymentId) ||
      (targetStatus === PaymentStatus.SUCCEEDED &&
        action.providerPaymentId === null)
    ) {
      return mismatch(
        'Payment identifiers, amount, currency, or provider references mismatch.',
      );
    }

    const changed = payment.status !== targetStatus;
    if (changed) {
      try {
        assertPaymentTransition(payment.status, targetStatus);
      } catch (error: unknown) {
        if (error instanceof InvalidPaymentTransitionError) {
          return {
            processingError:
              'The event would regress or skip the local payment state machine.',
            status: WebhookEventStatus.IGNORED,
            transition: null,
          };
        }
        throw error;
      }
    }

    if (targetStatus === PaymentStatus.SUCCEEDED) {
      const otherSuccess = await transaction.payment.findFirst({
        where: {
          id: { not: payment.id },
          orderId: payment.orderId,
          status: {
            in: [
              PaymentStatus.SUCCEEDED,
              PaymentStatus.PARTIALLY_REFUNDED,
              PaymentStatus.REFUNDED,
            ],
          },
        },
        select: { id: true },
      });
      if (otherSuccess || !canRepresentSuccessfulOrder(payment.order.status)) {
        return mismatch(
          'The order cannot represent a second successful payment.',
        );
      }
    }

    if (changed) {
      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId:
            payment.providerPaymentId ?? action.providerPaymentId,
          status: targetStatus,
        },
      });
    } else if (!payment.providerPaymentId && action.providerPaymentId) {
      await transaction.payment.update({
        where: { id: payment.id },
        data: { providerPaymentId: action.providerPaymentId },
      });
    }

    if (
      targetStatus === PaymentStatus.SUCCEEDED &&
      payment.order.status === OrderStatus.PENDING_PAYMENT
    ) {
      assertOrderTransition(payment.order.status, OrderStatus.PAID);
      await transaction.order.update({
        where: { id: payment.order.id },
        data: { status: OrderStatus.PAID },
      });
    }

    if (targetStatus === PaymentStatus.SUCCEEDED) {
      await appendPaymentSucceededEvent(transaction, {
        amount: payment.amount,
        currency: payment.currency,
        orderId: payment.orderId,
        paymentId: payment.id,
        provider,
        providerPaymentId:
          payment.providerPaymentId ?? action.providerPaymentId!,
      });
    }

    return {
      processingError: null,
      status: WebhookEventStatus.PROCESSED,
      transition: { changed, kind: 'PAYMENT', status: targetStatus },
    };
  }
}

export class PermanentWebhookError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'PermanentWebhookError';
  }
}

export class WebhookEventConflictError extends Error {
  readonly code = 'WEBHOOK_EVENT_ID_CONFLICT';

  constructor(
    readonly provider: DatabasePaymentProvider,
    readonly providerEventId: string,
  ) {
    super(
      `Provider event ${provider}:${providerEventId} was reused with different verified content.`,
    );
    this.name = 'WebhookEventConflictError';
  }
}

export function inboxDispatchRetryDelayMs(
  eventId: string,
  attemptNumber: number,
): number {
  const normalizedAttempt = Math.max(1, Math.trunc(attemptNumber));
  const exponent = Math.min(normalizedAttempt - 1, 20);
  const cappedDelayMs = Math.min(5_000 * 2 ** exponent, 15 * 60_000);
  const entropy = createHash('sha256')
    .update(`${eventId}:${normalizedAttempt}`)
    .digest('hex');
  const unitInterval = Number.parseInt(entropy.slice(0, 8), 16) / 0xffffffff;
  return Math.max(
    1_000,
    Math.floor(cappedDelayMs * (0.75 + unitInterval * 0.25)),
  );
}

export function isRetryableWebhookError(error: unknown): boolean {
  if (error instanceof PermanentWebhookError) {
    return false;
  }
  if (error instanceof PaymentProviderError) {
    return error.retryable;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034']).has(
      error.code,
    );
  }
  return true;
}

function parseAction(value: unknown): ProviderWebhookAction {
  const record = typeof value === 'object' && value !== null ? value : null;
  const kind = record && 'kind' in record ? record.kind : null;
  if (
    !new Set([
      'IGNORE',
      'REJECT',
      'CAPTURE_PAYMENT',
      'PAYMENT_TRANSITION',
      'REFUND_SYNC',
    ]).has(String(kind))
  ) {
    throw new PermanentWebhookError(
      'Persisted webhook action is missing or invalid.',
    );
  }
  return value as ProviderWebhookAction;
}

function databaseProvider(provider: string): DatabasePaymentProvider {
  if (provider === DatabasePaymentProvider.STRIPE) {
    return DatabasePaymentProvider.STRIPE;
  }
  if (provider === DatabasePaymentProvider.PAYPAL) {
    return DatabasePaymentProvider.PAYPAL;
  }
  if (provider === DatabasePaymentProvider.ALIPAY) {
    return DatabasePaymentProvider.ALIPAY;
  }
  throw new PermanentWebhookError(`Unsupported payment provider: ${provider}.`);
}

function captureTarget(
  status: ProviderPaymentStatus,
): ProviderPaymentTransitionAction['targetStatus'] {
  switch (status) {
    case ProviderPaymentStatus.SUCCEEDED:
      return ProviderPaymentStatus.SUCCEEDED;
    case ProviderPaymentStatus.PROCESSING:
    case ProviderPaymentStatus.PENDING:
      return ProviderPaymentStatus.PROCESSING;
    case ProviderPaymentStatus.FAILED:
      return ProviderPaymentStatus.FAILED;
  }
}

function localPaymentStatus(
  status: ProviderPaymentTransitionAction['targetStatus'],
):
  | typeof PaymentStatus.PROCESSING
  | typeof PaymentStatus.SUCCEEDED
  | typeof PaymentStatus.FAILED {
  switch (status) {
    case ProviderPaymentStatus.PROCESSING:
      return PaymentStatus.PROCESSING;
    case ProviderPaymentStatus.SUCCEEDED:
      return PaymentStatus.SUCCEEDED;
    case ProviderPaymentStatus.FAILED:
      return PaymentStatus.FAILED;
  }
}

function resolvedPaymentAction(
  action: ProviderPaymentTransitionAction,
): ResolvedPaymentTransitionAction {
  if (!action.orderId || !action.paymentId) {
    throw new PermanentWebhookError(
      'Payment transition was not resolved before projection.',
    );
  }
  return action as ResolvedPaymentTransitionAction;
}

function localRefundStatus(status: ProviderRefundStatus): RefundStatus {
  switch (status) {
    case ProviderRefundStatus.PENDING:
      return RefundStatus.PENDING;
    case ProviderRefundStatus.SUCCEEDED:
      return RefundStatus.SUCCEEDED;
    case ProviderRefundStatus.FAILED:
      return RefundStatus.FAILED;
  }
}

function canRepresentSuccessfulOrder(status: OrderStatus): boolean {
  if (status === OrderStatus.PENDING_PAYMENT) {
    try {
      assertOrderTransition(status, OrderStatus.PAID);
      return true;
    } catch (error: unknown) {
      if (error instanceof InvalidOrderTransitionError) {
        return false;
      }
      throw error;
    }
  }

  return new Set<OrderStatus>([
    OrderStatus.PAID,
    OrderStatus.FULFILLED,
    OrderStatus.PARTIALLY_REFUNDED,
    OrderStatus.REFUNDED,
  ]).has(status);
}

function mismatch(processingError: string): WebhookActionResult {
  return {
    processingError,
    status: WebhookEventStatus.FAILED,
    transition: null,
  };
}

function actionCorrelation(
  webhookEventId: string,
  provider: DatabasePaymentProvider,
  providerEventId: string,
  action: ProviderWebhookAction,
): WebhookCorrelation {
  return {
    provider,
    providerEventId,
    webhookEventId,
    ...('orderId' in action && action.orderId
      ? { orderId: action.orderId }
      : {}),
    ...('paymentId' in action && action.paymentId
      ? { paymentId: action.paymentId }
      : {}),
    ...('refundId' in action ? { refundId: action.refundId } : {}),
  };
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function webhookEventFingerprint(input: {
  eventType: string;
  payload: unknown;
  provider: DatabasePaymentProvider;
  providerEventId: string;
}): string {
  const canonical = canonicalJson({
    eventType: input.eventType,
    payload: input.payload,
    provider: input.provider,
    providerEventId: input.providerEventId,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function canonicalJson(value: unknown): string {
  const canonical = canonicalValue(value, false);
  const encoded = JSON.stringify(canonical);
  if (encoded === undefined) {
    throw new TypeError('Webhook fingerprint input must be JSON serializable.');
  }
  return encoded;
}

function canonicalValue(value: unknown, arrayItem: boolean): unknown {
  if (value === undefined || typeof value === 'function') {
    return arrayItem ? null : undefined;
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol') {
    throw new TypeError('Webhook fingerprint input must be JSON serializable.');
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalValue(item, true));
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .flatMap((key) => {
        const item = canonicalValue(record[key], false);
        return item === undefined ? [] : [[key, item]];
      }),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unknown webhook processing error.';
}
