import { WebhookEventStatus } from '@payflow/database';
import { PaymentProviderRegistry } from '@payflow/payment-core';
import {
  isRetryableWebhookError,
  PermanentWebhookError,
  WebhookEventStore,
} from '@payflow/payment-domain';
import {
  createWebhookWorker,
  PayFlowWebhookQueue,
  type WebhookWorker,
  unrecoverable,
} from '@payflow/payment-queue';

import { DatabaseService } from '../src/database/database.service';

export function startTestWebhookWorker(
  database: DatabaseService,
  providers: PaymentProviderRegistry,
): WebhookWorker {
  const store = new WebhookEventStore(database.prisma);
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const queue = new PayFlowWebhookQueue(redisUrl);
  const worker = createWebhookWorker(
    redisUrl,
    async (job) => {
      await store.beginAttempt(job.data.webhookEventId);
      try {
        const result = await store.process(job.data.webhookEventId, providers);
        if (result.status === WebhookEventStatus.FAILED) {
          throw new PermanentWebhookError(
            'Webhook failed local integrity or state-machine checks.',
          );
        }
      } catch (error: unknown) {
        const retryable = isRetryableWebhookError(error);
        const final =
          !retryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        await store.recordAttemptFailure(job.data.webhookEventId, error, final);
        throw retryable
          ? error instanceof Error
            ? error
            : new Error('Unknown retryable webhook processing error.')
          : unrecoverable(error);
      }
    },
    { concurrency: 4 },
  );
  let dispatching = false;
  const dispatch = async (): Promise<void> => {
    if (dispatching) {
      return;
    }
    dispatching = true;
    try {
      for (const event of await store.listUndispatched(50)) {
        const attemptNumber = await store.beginDispatchAttempt(event.id);
        if (attemptNumber === null) {
          continue;
        }
        try {
          const jobId = await queue.enqueue(event.id);
          await store.markQueued(event.id, jobId);
        } catch (error: unknown) {
          await store.recordDispatchFailure(event.id, attemptNumber, error);
        }
      }
    } finally {
      dispatching = false;
    }
  };
  void dispatch();
  const timer = setInterval(() => void dispatch(), 25);
  const closeWorker = worker.close.bind(worker);
  worker.close = async (force?: boolean): Promise<void> => {
    clearInterval(timer);
    await Promise.all([closeWorker(force), queue.close()]);
  };
  return worker;
}

export async function waitForWebhookStatus(
  database: DatabaseService,
  providerEventId: string,
  expected: WebhookEventStatus,
  provider: 'ALIPAY' | 'PAYPAL' | 'STRIPE' = 'STRIPE',
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let status: WebhookEventStatus | null = null;

  while (Date.now() < deadline) {
    const event = await database.prisma.webhookEvent.findUnique({
      where: {
        provider_providerEventId: { provider, providerEventId },
      },
      select: { status: true },
    });
    status = event?.status ?? null;
    if (status === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Webhook ${providerEventId} did not reach ${expected}; last status was ${status ?? 'missing'}.`,
  );
}
