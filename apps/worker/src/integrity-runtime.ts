import type { PrismaClient } from '@payflow/database';
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
        await store.postToLedger(job.data.outboxEventId);
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
    options.outboxPollIntervalMs,
  );
  const reconciliationScheduler = new ReconciliationScheduler(
    new ReconciliationService(options.prisma, options.providers),
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
      await this.publishPending();
    } catch (error: unknown) {
      console.error('PayFlow outbox publisher failed.', {
        message: error instanceof Error ? error.message : 'Unknown error.',
      });
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
      await this.reconciliation.run({
        windowEnd: now,
        windowStart: new Date(now.getTime() - this.lookbackMs),
      });
    } catch (error: unknown) {
      console.error('PayFlow reconciliation run failed.', {
        message: error instanceof Error ? error.message : 'Unknown error.',
      });
    } finally {
      this.active = false;
    }
  }
}

function positiveInterval(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
