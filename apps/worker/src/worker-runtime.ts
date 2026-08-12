import {
  PaymentStatus,
  RefundStatus,
  WebhookEventStatus,
  type PrismaClient,
} from '@payflow/database';
import {
  JsonLogger,
  recordPaymentFailure,
  recordPaymentSuccess,
  recordRefundFailure,
  recordWebhookProcessing,
} from '@payflow/observability';
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
  logger?: JsonLogger;
  prefix?: string;
  prisma: PrismaClient;
  providers: PaymentProviderRegistry;
  redisUrl: string;
}): WebhookWorker {
  const store = new WebhookEventStore(options.prisma);

  return createWebhookWorker(
    options.redisUrl,
    async (job: WebhookJob): Promise<void> => {
      const startedAt = performance.now();
      let outcome = 'error';
      let provider = 'unknown';
      await store.beginAttempt(job.data.webhookEventId);

      try {
        const result = await store.process(
          job.data.webhookEventId,
          options.providers,
        );
        provider = result.correlation.provider;
        outcome = result.status;
        if (result.status === WebhookEventStatus.FAILED) {
          throw new PermanentWebhookError(
            'Webhook failed local integrity or state-machine checks.',
          );
        }
        if (result.transition?.changed) {
          if (
            result.transition.kind === 'PAYMENT' &&
            result.transition.status === PaymentStatus.SUCCEEDED
          ) {
            recordPaymentSuccess({ provider });
          } else if (
            result.transition.kind === 'PAYMENT' &&
            result.transition.status === PaymentStatus.FAILED
          ) {
            recordPaymentFailure({ provider });
          } else if (
            result.transition.kind === 'REFUND' &&
            result.transition.status === RefundStatus.FAILED
          ) {
            recordRefundFailure({ provider });
          }
        }
        options.logger?.info('webhook.processing.completed', {
          ...result.correlation,
          changed: result.transition?.changed ?? false,
          status: result.status,
          transition: result.transition?.status ?? null,
        });
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
      } finally {
        recordWebhookProcessing((performance.now() - startedAt) / 1_000, {
          outcome,
          provider,
        });
      }
    },
    { concurrency: options.concurrency, prefix: options.prefix },
  );
}
