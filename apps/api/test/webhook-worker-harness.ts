import { WebhookEventStatus } from '@payflow/database';
import { PaymentProviderRegistry } from '@payflow/payment-core';
import {
  isRetryableWebhookError,
  PermanentWebhookError,
  WebhookEventStore,
} from '@payflow/payment-domain';
import {
  createWebhookWorker,
  type WebhookWorker,
  unrecoverable,
} from '@payflow/payment-queue';

import { DatabaseService } from '../src/database/database.service';

export function startTestWebhookWorker(
  database: DatabaseService,
  providers: PaymentProviderRegistry,
): WebhookWorker {
  const store = new WebhookEventStore(database.prisma);

  return createWebhookWorker(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
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
}

export async function waitForWebhookStatus(
  database: DatabaseService,
  providerEventId: string,
  expected: WebhookEventStatus,
  provider: 'PAYPAL' | 'STRIPE' = 'STRIPE',
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
