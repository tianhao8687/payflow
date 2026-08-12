import type { PrismaClient } from '@payflow/database';
import { JsonLogger, SpanKind, withSpan } from '@payflow/observability';
import { PaymentProviderRegistry } from '@payflow/payment-core';
import {
  isRetryableOutboxError,
  OutboxEventStore,
  ReconciliationService,
} from '@payflow/payment-domain';
import {
  createOutboxWorker,
  type OutboxJob,
  type OutboxWorker,
  PayFlowOutboxQueue,
  unrecoverable,
} from '@payflow/payment-queue';

export interface IntegrityRuntime {
  close(): Promise<void>;
  outboxPublisher: OutboxPublisher;
  outboxWorker: OutboxWorker;
  reconciliationScheduler: ReconciliationScheduler;
}

export function startIntegrityRuntime(options: {
  logger?: JsonLogger;
  outboxConcurrency?: number;
  outboxPollIntervalMs?: number;
  prefix?: string;
  prisma: PrismaClient;
  providers: PaymentProviderRegistry;
  reconciliationIntervalMs?: number;
  reconciliationLookbackMs?: number;
  redisUrl: string;
}): IntegrityRuntime {
  const store = new OutboxEventStore(options.prisma);
  const queue = new PayFlowOutboxQueue(options.redisUrl, options.prefix);
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

  outboxPublisher.start();
  reconciliationScheduler.start();

  return {
    outboxPublisher,
    outboxWorker,
    reconciliationScheduler,
    async close(): Promise<void> {
      outboxPublisher.stop();
      reconciliationScheduler.stop();
      await Promise.all([outboxWorker.close(), queue.close()]);
    },
  };
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
