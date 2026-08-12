import { WebhookEventStatus, type PrismaClient } from '@payflow/database';
import { PaymentProviderRegistry } from '@payflow/payment-core';
import {
  isRetryableWebhookError,
  PermanentWebhookError,
  WebhookEventStore,
} from '@payflow/payment-domain';
import {
  createWebhookWorker,
  type WebhookJob,
  type WebhookWorker,
  unrecoverable,
} from '@payflow/payment-queue';

export function startWebhookWorker(options: {
  concurrency?: number;
  prefix?: string;
  prisma: PrismaClient;
  providers: PaymentProviderRegistry;
  redisUrl: string;
}): WebhookWorker {
  const store = new WebhookEventStore(options.prisma);

  return createWebhookWorker(
    options.redisUrl,
    async (job: WebhookJob): Promise<void> => {
      await store.beginAttempt(job.data.webhookEventId);

      try {
        const result = await store.process(
          job.data.webhookEventId,
          options.providers,
        );
        if (result.status === WebhookEventStatus.FAILED) {
          throw new PermanentWebhookError(
            'Webhook failed local integrity or state-machine checks.',
          );
        }
      } catch (error: unknown) {
        const retryable = isRetryableWebhookError(error);
        const attempts = job.opts.attempts ?? 1;
        const final = !retryable || job.attemptsMade + 1 >= attempts;
        await store.recordAttemptFailure(job.data.webhookEventId, error, final);

        if (!retryable) {
          throw unrecoverable(error);
        }
        throw error instanceof Error
          ? error
          : new Error('Unknown retryable webhook processing error.');
      }
    },
    { concurrency: options.concurrency, prefix: options.prefix },
  );
}
