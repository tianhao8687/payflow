import {
  LedgerDirection,
  LedgerTransactionType,
  OutboxEventStatus,
  Prisma,
  type PrismaClient,
} from '@payflow/database';

export const DomainEventType = {
  PAYMENT_SUCCEEDED: 'PAYMENT_SUCCEEDED',
  REFUND_SUCCEEDED: 'REFUND_SUCCEEDED',
} as const;

export type DomainEventType =
  (typeof DomainEventType)[keyof typeof DomainEventType];

export interface PaymentSucceededEvent {
  amount: number;
  currency: string;
  orderId: string;
  paymentId: string;
  provider: string;
  providerPaymentId: string;
}

export interface RefundSucceededEvent extends PaymentSucceededEvent {
  refundId: string;
}

export interface PendingOutboxEvent {
  id: string;
}

export interface OutboxProcessingResult {
  duplicate: boolean;
  ledgerTransactionId: string;
}

export async function appendPaymentSucceededEvent(
  transaction: Prisma.TransactionClient,
  payload: PaymentSucceededEvent,
): Promise<void> {
  await append(transaction, {
    aggregateId: payload.paymentId,
    aggregateType: 'PAYMENT',
    eventKey: `payment.succeeded:${payload.paymentId}`,
    eventType: DomainEventType.PAYMENT_SUCCEEDED,
    payload,
  });
}

export async function appendRefundSucceededEvent(
  transaction: Prisma.TransactionClient,
  payload: RefundSucceededEvent,
): Promise<void> {
  await append(transaction, {
    aggregateId: payload.refundId,
    aggregateType: 'REFUND',
    eventKey: `refund.succeeded:${payload.refundId}`,
    eventType: DomainEventType.REFUND_SUCCEEDED,
    payload,
  });
}

export class OutboxEventStore {
  constructor(private readonly prisma: PrismaClient) {}

  listPending(limit = 50): Promise<PendingOutboxEvent[]> {
    return this.prisma.outboxEvent.findMany({
      where: { status: OutboxEventStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async beginPublishAttempt(eventId: string): Promise<boolean> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: { id: eventId, status: OutboxEventStatus.PENDING },
      data: { lastError: null, publishAttempts: { increment: 1 } },
    });
    return result.count === 1;
  }

  async markPublished(eventId: string, queueJobId: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: {
        id: eventId,
        status: {
          in: [OutboxEventStatus.PENDING, OutboxEventStatus.PUBLISHED],
        },
      },
      data: {
        lastError: null,
        publishedAt: new Date(),
        queueJobId,
        status: OutboxEventStatus.PUBLISHED,
      },
    });
  }

  async recordPublishFailure(eventId: string, error: unknown): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id: eventId, status: OutboxEventStatus.PENDING },
      data: { lastError: errorMessage(error).slice(0, 500) },
    });
  }

  async beginProcessing(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: {
        id: eventId,
        status: {
          in: [OutboxEventStatus.PENDING, OutboxEventStatus.PUBLISHED],
        },
      },
      data: { lastError: null, processingAttempts: { increment: 1 } },
    });
  }

  async recordProcessingFailure(
    eventId: string,
    error: unknown,
    final: boolean,
  ): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: {
        id: eventId,
        status: {
          in: [OutboxEventStatus.PENDING, OutboxEventStatus.PUBLISHED],
        },
      },
      data: {
        lastError: errorMessage(error).slice(0, 500),
        processedAt: final ? new Date() : null,
        status: final ? OutboxEventStatus.FAILED : OutboxEventStatus.PUBLISHED,
      },
    });
  }

  async postToLedger(eventId: string): Promise<OutboxProcessingResult> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT 1::integer AS acquired
            FROM pg_advisory_xact_lock(hashtextextended(${`outbox:${eventId}`}, 0))`,
        );
        const event = await transaction.outboxEvent.findUnique({
          where: { id: eventId },
          include: { ledgerTransaction: { select: { id: true } } },
        });

        if (!event) {
          throw new PermanentOutboxError(
            'The queued outbox event does not exist.',
          );
        }
        if (event.ledgerTransaction) {
          await markProcessed(transaction, event.id, event.publishedAt);
          return {
            duplicate: true,
            ledgerTransactionId: event.ledgerTransaction.id,
          };
        }
        if (event.status === OutboxEventStatus.FAILED) {
          throw new PermanentOutboxError(
            'The outbox event is already in a terminal failed state.',
          );
        }

        const payload = parseMoneyEvent(event.eventType, event.payloadJson);
        const transactionType =
          event.eventType === DomainEventType.PAYMENT_SUCCEEDED
            ? LedgerTransactionType.PAYMENT
            : LedgerTransactionType.REFUND;
        const receivable = await account(
          transaction,
          'PROVIDER_RECEIVABLE',
          'Provider receivable',
          payload.currency,
        );
        const clearing = await account(
          transaction,
          'CUSTOMER_PAYMENT_CLEARING',
          'Customer payment clearing',
          payload.currency,
        );
        const ledgerTransaction = await transaction.ledgerTransaction.create({
          data: {
            currency: payload.currency,
            outboxEventId: event.id,
            referenceId:
              event.eventType === DomainEventType.PAYMENT_SUCCEEDED
                ? payload.paymentId
                : refundPayload(payload).refundId,
            referenceType:
              event.eventType === DomainEventType.PAYMENT_SUCCEEDED
                ? 'PAYMENT'
                : 'REFUND',
            transactionType,
            entries: {
              create:
                transactionType === LedgerTransactionType.PAYMENT
                  ? [
                      entry(receivable.id, LedgerDirection.DEBIT, payload),
                      entry(clearing.id, LedgerDirection.CREDIT, payload),
                    ]
                  : [
                      entry(clearing.id, LedgerDirection.DEBIT, payload),
                      entry(receivable.id, LedgerDirection.CREDIT, payload),
                    ],
            },
          },
          select: { id: true },
        });

        await transaction.auditLog.create({
          data: {
            action: 'LEDGER_TRANSACTION_POSTED',
            actorType: 'SYSTEM',
            metadataJson: {
              amount: payload.amount,
              currency: payload.currency,
              eventType: event.eventType,
              outboxEventId: event.id,
            },
            targetId: ledgerTransaction.id,
            targetType: 'LEDGER_TRANSACTION',
          },
        });
        await markProcessed(transaction, event.id, event.publishedAt);

        return {
          duplicate: false,
          ledgerTransactionId: ledgerTransaction.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}

export class PermanentOutboxError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'PermanentOutboxError';
  }
}

export function isRetryableOutboxError(error: unknown): boolean {
  if (error instanceof PermanentOutboxError) {
    return false;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034']).has(
      error.code,
    );
  }
  return true;
}

interface AppendInput {
  aggregateId: string;
  aggregateType: string;
  eventKey: string;
  eventType: DomainEventType;
  payload: PaymentSucceededEvent | RefundSucceededEvent;
}

async function append(
  transaction: Prisma.TransactionClient,
  input: AppendInput,
): Promise<void> {
  await transaction.outboxEvent.upsert({
    where: { eventKey: input.eventKey },
    create: {
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      eventKey: input.eventKey,
      eventType: input.eventType,
      payloadJson: json(input.payload),
    },
    update: {},
  });
}

async function account(
  transaction: Prisma.TransactionClient,
  code: string,
  name: string,
  currency: string,
): Promise<{ id: string }> {
  return transaction.ledgerAccount.upsert({
    where: { code_currency: { code, currency } },
    create: { code, currency, name },
    update: { name },
    select: { id: true },
  });
}

function entry(
  accountId: string,
  direction: LedgerDirection,
  payload: PaymentSucceededEvent | RefundSucceededEvent,
) {
  return {
    accountId,
    amount: payload.amount,
    currency: payload.currency,
    direction,
  };
}

async function markProcessed(
  transaction: Prisma.TransactionClient,
  eventId: string,
  publishedAt: Date | null,
): Promise<void> {
  await transaction.outboxEvent.update({
    where: { id: eventId },
    data: {
      lastError: null,
      processedAt: new Date(),
      publishedAt: publishedAt ?? new Date(),
      status: OutboxEventStatus.PROCESSED,
    },
  });
}

function parseMoneyEvent(
  eventType: string,
  value: unknown,
): PaymentSucceededEvent | RefundSucceededEvent {
  if (
    eventType !== DomainEventType.PAYMENT_SUCCEEDED &&
    eventType !== DomainEventType.REFUND_SUCCEEDED
  ) {
    throw new PermanentOutboxError(`Unsupported outbox event: ${eventType}.`);
  }
  if (!isRecord(value)) {
    throw new PermanentOutboxError('Outbox payload must be an object.');
  }

  const payload = {
    amount: value.amount,
    currency: value.currency,
    orderId: value.orderId,
    paymentId: value.paymentId,
    provider: value.provider,
    providerPaymentId: value.providerPaymentId,
    ...(eventType === DomainEventType.REFUND_SUCCEEDED
      ? { refundId: value.refundId }
      : {}),
  };
  if (
    !Number.isSafeInteger(payload.amount) ||
    Number(payload.amount) < 1 ||
    typeof payload.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(payload.currency) ||
    !strings(payload.orderId, payload.paymentId, payload.providerPaymentId) ||
    (eventType === DomainEventType.REFUND_SUCCEEDED &&
      (!('refundId' in payload) || typeof payload.refundId !== 'string'))
  ) {
    throw new PermanentOutboxError(
      'Outbox money event is missing valid identifiers, currency, or amount.',
    );
  }

  return payload as PaymentSucceededEvent | RefundSucceededEvent;
}

function strings(...values: unknown[]): boolean {
  return values.every((value) => typeof value === 'string' && value.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unknown outbox processing error.';
}

function refundPayload(
  payload: PaymentSucceededEvent | RefundSucceededEvent,
): RefundSucceededEvent {
  if (!('refundId' in payload)) {
    throw new PermanentOutboxError('Refund event is missing its refund ID.');
  }
  return payload;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
