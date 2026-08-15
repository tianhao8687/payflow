import type { PrismaClient } from '@payflow/database';
import {
  JsonLogger,
  recordInboxDispatchFailure,
  recordInboxDispatchLag,
  recordInboxDispatchRetry,
  recordInboxOldestEventAge,
  SpanKind,
  withSpan,
} from '@payflow/observability';
import { PaymentProviderRegistry } from '@payflow/payment-core';
import {
  isRetryableOutboxError,
  OutboxEventStore,
  PaymentRecoveryService,
  ReconciliationService,
  WebhookEventStore,
} from '@payflow/payment-domain';
import {
  createOutboxWorker,
  type OutboxJob,
  type OutboxWorker,
  PayFlowOutboxQueue,
  PayFlowWebhookQueue,
  unrecoverable,
} from '@payflow/payment-queue';

export interface IntegrityRuntime {
  close(): Promise<void>;
  inboxDispatcher: InboxDispatcher;
  outboxPublisher: OutboxPublisher;
  outboxWorker: OutboxWorker;
  paymentRecoveryScheduler: PaymentRecoveryScheduler;
  reconciliationScheduler: ReconciliationScheduler;
}

export function startIntegrityRuntime(options: {
  inboxPollIntervalMs?: number;
  logger?: JsonLogger;
  outboxConcurrency?: number;
  outboxPollIntervalMs?: number;
  prefix?: string;
  prisma: PrismaClient;
  providers: PaymentProviderRegistry;
  paymentRecoveryIntervalMs?: number;
  reconciliationIntervalMs?: number;
  reconciliationLookbackMs?: number;
  redisUrl: string;
}): IntegrityRuntime {
  const store = new OutboxEventStore(options.prisma);
  const queue = new PayFlowOutboxQueue(options.redisUrl, options.prefix);
  const webhookQueue = new PayFlowWebhookQueue(
    options.redisUrl,
    options.prefix,
  );
  const outboxWorker = createOutboxWorker(
    options.redisUrl,
    async (job: OutboxJob): Promise<void> => {
      await store.beginProcessing(job.data.outboxEventId);
      try {
        const result = await store.postToLedger(job.data.outboxEventId);
        options.logger?.info('outbox.processing.completed', {
          duplicate: result.duplicate,
          ledgerTransactionId: result.ledgerTransactionId,
          outboxEventId: job.data.outboxEventId,
        });
      } catch (error: unknown) {
        const retryable = isRetryableOutboxError(error);
        const final =
          !retryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        await store.recordProcessingFailure(
          job.data.outboxEventId,
          error,
          final,
        );
        throw retryable
          ? error instanceof Error
            ? error
            : new Error('Unknown retryable outbox processing error.')
          : unrecoverable(error);
      }
    },
    {
      concurrency: options.outboxConcurrency,
      prefix: options.prefix,
    },
  );
  const outboxPublisher = new OutboxPublisher(
    store,
    queue,
    options.logger,
    options.outboxPollIntervalMs,
  );
  const reconciliationScheduler = new ReconciliationScheduler(
    new ReconciliationService(options.prisma, options.providers),
    options.logger,
    options.reconciliationIntervalMs,
    options.reconciliationLookbackMs,
  );
  const inboxDispatcher = new InboxDispatcher(
    new WebhookEventStore(options.prisma),
    webhookQueue,
    options.logger,
    options.inboxPollIntervalMs,
  );
  const paymentRecoveryScheduler = new PaymentRecoveryScheduler(
    new PaymentRecoveryService(options.prisma, options.providers),
    options.logger,
    options.paymentRecoveryIntervalMs,
  );

  outboxPublisher.start();
  inboxDispatcher.start();
  paymentRecoveryScheduler.start();
  reconciliationScheduler.start();

  return {
    inboxDispatcher,
    outboxPublisher,
    outboxWorker,
    paymentRecoveryScheduler,
    reconciliationScheduler,
    async close(): Promise<void> {
      outboxPublisher.stop();
      inboxDispatcher.stop();
      paymentRecoveryScheduler.stop();
      reconciliationScheduler.stop();
      await Promise.all([
        outboxWorker.close(),
        queue.close(),
        webhookQueue.close(),
      ]);
    },
  };
}

export class PaymentRecoveryScheduler {
  private active = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;

  constructor(
    private readonly recovery: PaymentRecoveryService,
    private readonly logger?: JsonLogger,
    intervalMs = 15_000,
  ) {
    this.intervalMs = positiveInterval(intervalMs, 15_000);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.active) {
      return;
    }
    this.active = true;
    try {
      const result = await withSpan(
        'payment.recovery.batch',
        { kind: SpanKind.INTERNAL },
        () => this.recovery.recoverExpiredBatch(),
      );
      if (result.scanned > 0) {
        this.logger?.info('payment.recovery.completed', { ...result });
      }
    } catch (error: unknown) {
      this.logger?.error('payment.recovery.failed', { error });
    } finally {
      this.active = false;
    }
  }
}

export class InboxDispatcher {
  private active = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly store: WebhookEventStore,
    private readonly queue: PayFlowWebhookQueue,
    private readonly logger?: JsonLogger,
    pollIntervalMs = 500,
  ) {
    this.pollIntervalMs = positiveInterval(pollIntervalMs, 500);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.dispatchScheduled();
    this.timer = setInterval(
      () => void this.dispatchScheduled(),
      this.pollIntervalMs,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async dispatchPending(limit = 50): Promise<number> {
    if (this.active) {
      return 0;
    }
    this.active = true;
    let dispatched = 0;
    try {
      const events = await this.store.listUndispatched(limit);
      if (events[0]) {
        recordInboxOldestEventAge(
          Math.max(0, (Date.now() - events[0].receivedAt.getTime()) / 1_000),
        );
      }
      for (const event of events) {
        const attemptNumber = await this.store.beginDispatchAttempt(event.id);
        if (attemptNumber === null) {
          continue;
        }
        try {
          const jobId = await this.queue.enqueue(event.id);
          await this.store.markQueued(event.id, jobId);
          recordInboxDispatchLag(
            Math.max(0, (Date.now() - event.receivedAt.getTime()) / 1_000),
            { provider: event.provider },
          );
          dispatched += 1;
        } catch (error: unknown) {
          const retry = await this.store.recordDispatchFailure(
            event.id,
            attemptNumber,
            error,
          );
          recordInboxDispatchFailure({ provider: event.provider });
          if (retry) {
            recordInboxDispatchRetry(retry.retryDelayMs / 1_000, {
              provider: event.provider,
            });
            this.logger?.warn('webhook.inbox.dispatch.retry_scheduled', {
              attemptNumber,
              eventId: event.id,
              nextDispatchAt: retry.nextDispatchAt.toISOString(),
              provider: event.provider,
            });
          }
        }
      }
      return dispatched;
    } finally {
      this.active = false;
    }
  }

  private async dispatchScheduled(): Promise<void> {
    try {
      const dispatched = await withSpan(
        'webhook.inbox.dispatch.batch',
        { kind: SpanKind.PRODUCER },
        () => this.dispatchPending(),
      );
      if (dispatched > 0) {
        this.logger?.info('webhook.inbox.dispatch.completed', { dispatched });
      }
    } catch (error: unknown) {
      this.logger?.error('webhook.inbox.dispatch.failed', { error });
    }
  }
}

export class OutboxPublisher {
  private active = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly store: OutboxEventStore,
    private readonly queue: PayFlowOutboxQueue,
    private readonly logger?: JsonLogger,
    pollIntervalMs = 500,
  ) {
    this.pollIntervalMs = positiveInterval(pollIntervalMs, 500);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.publishScheduled();
    this.timer = setInterval(
      () => void this.publishScheduled(),
      this.pollIntervalMs,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async publishPending(limit = 50): Promise<number> {
    if (this.active) {
      return 0;
    }
    this.active = true;
    let published = 0;

    try {
      const events = await this.store.listPending(limit);
      for (const event of events) {
        if (!(await this.store.beginPublishAttempt(event.id))) {
          continue;
        }
        try {
          const jobId = await this.queue.enqueue(event.id);
          await this.store.markPublished(event.id, jobId);
          published += 1;
        } catch (error: unknown) {
          await this.store.recordPublishFailure(event.id, error);
        }
      }
      return published;
    } finally {
      this.active = false;
    }
  }

  private async publishScheduled(): Promise<void> {
    try {
      const published = await withSpan(
        'outbox.publish.batch',
        { kind: SpanKind.PRODUCER },
        () => this.publishPending(),
      );
      if (published > 0) {
        this.logger?.info('outbox.publish.completed', { published });
      }
    } catch (error: unknown) {
      this.logger?.error('outbox.publisher.failed', { error });
    }
  }
}

export class ReconciliationScheduler {
  private active = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly lookbackMs: number;

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly logger?: JsonLogger,
    intervalMs = 15 * 60 * 1_000,
    lookbackMs = 24 * 60 * 60 * 1_000,
  ) {
    this.intervalMs = positiveInterval(intervalMs, 15 * 60 * 1_000);
    this.lookbackMs = positiveInterval(lookbackMs, 24 * 60 * 60 * 1_000);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(now = new Date()): Promise<void> {
    if (this.active) {
      return;
    }
    this.active = true;
    try {
      const result = await withSpan(
        'reconciliation.run',
        { kind: SpanKind.INTERNAL },
        () =>
          this.reconciliation.run({
            windowEnd: now,
            windowStart: new Date(now.getTime() - this.lookbackMs),
          }),
      );
      this.logger?.info('reconciliation.run.completed', { ...result });
    } catch (error: unknown) {
      this.logger?.error('reconciliation.run.failed', { error });
    } finally {
      this.active = false;
    }
  }
}

function positiveInterval(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
