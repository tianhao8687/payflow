import { createPrismaClient } from '@payflow/database';
import { JsonLogger } from '@payflow/observability';
import {
  AlipayProvider,
  type AlipayProviderOptions,
} from '@payflow/payment-alipay';
import { PaymentProviderRegistry } from '@payflow/payment-core';
import { PayPalProvider } from '@payflow/payment-paypal';
import { StripeProvider } from '@payflow/payment-stripe';

import { startIntegrityRuntime } from './integrity-runtime';
import { startWebhookWorker } from './worker-runtime';

export interface WorkerRuntime {
  close(): Promise<void>;
}

export async function bootstrap(logger: JsonLogger): Promise<WorkerRuntime> {
  const environment = readEnvironment(process.env);
  const prisma = createPrismaClient(environment.databaseUrl);
  const providers = new PaymentProviderRegistry([
    new StripeProvider({
      appName: 'PayFlow Worker',
      appVersion: '0.11.0',
      secretKey: environment.stripeReconciliationKey,
      webhookSecret: '',
    }),
    new PayPalProvider({
      clientId: environment.paypalClientId,
      clientSecret: environment.paypalClientSecret,
      webhookId: '',
    }),
    new AlipayProvider(environment.alipay),
  ]);

  await prisma.$connect();
  const worker = startWebhookWorker({
    concurrency: environment.concurrency,
    logger,
    prisma,
    providers,
    redisUrl: environment.redisUrl,
  });
  const integrity = startIntegrityRuntime({
    inboxPollIntervalMs: environment.inboxPollIntervalMs,
    logger,
    outboxConcurrency: environment.outboxConcurrency,
    outboxPollIntervalMs: environment.outboxPollIntervalMs,
    paymentRecoveryIntervalMs: environment.paymentRecoveryIntervalMs,
    prisma,
    providers,
    reconciliationIntervalMs: environment.reconciliationIntervalMs,
    reconciliationLookbackMs: environment.reconciliationLookbackMs,
    redisUrl: environment.redisUrl,
  });

  worker.on('ready', () => logger.info('webhook.worker.ready'));
  worker.on('failed', (job, error) => {
    logger.error('webhook.job.failed', {
      attemptsMade: job?.attemptsMade,
      error,
      jobId: job?.id,
      webhookEventId: job?.data.webhookEventId,
    });
  });
  worker.on('error', (error) => {
    logger.error('webhook.worker.error', { error });
  });
  integrity.outboxWorker.on('ready', () => logger.info('outbox.worker.ready'));
  integrity.outboxWorker.on('failed', (job, error) => {
    logger.error('outbox.job.failed', {
      attemptsMade: job?.attemptsMade,
      error,
      jobId: job?.id,
      outboxEventId: job?.data.outboxEventId,
    });
  });
  integrity.outboxWorker.on('error', (error) => {
    logger.error('outbox.worker.error', { error });
  });
  logger.info('worker.ready');

  return {
    async close(): Promise<void> {
      await Promise.all([worker.close(), integrity.close()]);
      await prisma.$disconnect();
    },
  };
}

interface WorkerEnvironment {
  alipay: AlipayProviderOptions;
  concurrency: number;
  databaseUrl: string;
  inboxPollIntervalMs: number;
  outboxConcurrency: number;
  outboxPollIntervalMs: number;
  paypalClientId: string;
  paypalClientSecret: string;
  paymentRecoveryIntervalMs: number;
  reconciliationIntervalMs: number;
  reconciliationLookbackMs: number;
  redisUrl: string;
  stripeReconciliationKey: string;
}

function readEnvironment(values: NodeJS.ProcessEnv): WorkerEnvironment {
  const databaseUrl = values.DATABASE_URL ?? '';
  const redisUrl = values.REDIS_URL ?? '';
  const concurrency = Number(values.WEBHOOK_WORKER_CONCURRENCY ?? 8);
  const outboxConcurrency = Number(values.OUTBOX_WORKER_CONCURRENCY ?? 4);
  const outboxPollIntervalMs = Number(values.OUTBOX_POLL_INTERVAL_MS ?? 500);
  const inboxPollIntervalMs = Number(values.INBOX_POLL_INTERVAL_MS ?? 500);
  const reconciliationIntervalMs = Number(
    values.RECONCILIATION_INTERVAL_MS ?? 900_000,
  );
  const paymentRecoveryIntervalMs = Number(
    values.PAYMENT_RECOVERY_INTERVAL_MS ?? 15_000,
  );
  const reconciliationLookbackMs = Number(
    values.RECONCILIATION_LOOKBACK_MS ?? 86_400_000,
  );
  const stripeReconciliationKey = values.STRIPE_RECONCILIATION_KEY ?? '';
  const alipayEnabled = readBoolean(
    values.ALIPAY_ENABLED,
    'ALIPAY_ENABLED',
    false,
  );
  const alipayAllowProduction = readBoolean(
    values.ALIPAY_ALLOW_PRODUCTION,
    'ALIPAY_ALLOW_PRODUCTION',
    false,
  );
  const alipayEnvironment = values.ALIPAY_ENV ?? 'sandbox';

  if (!databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
    throw new Error('REDIS_URL must be a Redis connection URL.');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new Error('WEBHOOK_WORKER_CONCURRENCY must be between 1 and 64.');
  }
  if (
    !Number.isInteger(outboxConcurrency) ||
    outboxConcurrency < 1 ||
    outboxConcurrency > 32
  ) {
    throw new Error('OUTBOX_WORKER_CONCURRENCY must be between 1 and 32.');
  }
  if (
    !Number.isInteger(paymentRecoveryIntervalMs) ||
    paymentRecoveryIntervalMs < 5_000
  ) {
    throw new Error('PAYMENT_RECOVERY_INTERVAL_MS must be at least 5000.');
  }
  if (!Number.isInteger(outboxPollIntervalMs) || outboxPollIntervalMs < 100) {
    throw new Error('OUTBOX_POLL_INTERVAL_MS must be at least 100.');
  }
  if (!Number.isInteger(inboxPollIntervalMs) || inboxPollIntervalMs < 100) {
    throw new Error('INBOX_POLL_INTERVAL_MS must be at least 100.');
  }
  if (
    !Number.isInteger(reconciliationIntervalMs) ||
    reconciliationIntervalMs < 60_000
  ) {
    throw new Error('RECONCILIATION_INTERVAL_MS must be at least 60000.');
  }
  if (
    !Number.isInteger(reconciliationLookbackMs) ||
    reconciliationLookbackMs < reconciliationIntervalMs
  ) {
    throw new Error(
      'RECONCILIATION_LOOKBACK_MS must be at least the reconciliation interval.',
    );
  }
  if (
    stripeReconciliationKey &&
    !stripeReconciliationKey.startsWith('rk_test_') &&
    !stripeReconciliationKey.startsWith('sk_test_')
  ) {
    throw new Error(
      'STRIPE_RECONCILIATION_KEY must be a Stripe test-mode restricted or secret key.',
    );
  }
  if ((values.PAYPAL_ENV ?? 'sandbox') !== 'sandbox') {
    throw new Error(
      'Only PayPal sandbox mode is allowed in this implementation.',
    );
  }
  if (!new Set(['sandbox', 'production']).has(alipayEnvironment)) {
    throw new Error('ALIPAY_ENV must be sandbox or production.');
  }

  return {
    alipay: {
      allowProduction: alipayAllowProduction,
      alipayPublicCertContent: values.ALIPAY_ALIPAY_PUBLIC_CERT_CONTENT ?? '',
      alipayPublicKey: values.ALIPAY_PUBLIC_KEY ?? '',
      alipayRootCertContent: values.ALIPAY_ALIPAY_ROOT_CERT_CONTENT ?? '',
      appCertContent: values.ALIPAY_APP_CERT_CONTENT ?? '',
      appId: values.ALIPAY_APP_ID ?? '',
      enabled: alipayEnabled,
      environment: alipayEnvironment as 'production' | 'sandbox',
      gatewayUrl:
        values.ALIPAY_GATEWAY_URL ??
        (alipayEnvironment === 'production'
          ? 'https://openapi.alipay.com/gateway.do'
          : 'https://openapi-sandbox.dl.alipaydev.com/gateway.do'),
      notifyUrl:
        values.ALIPAY_NOTIFY_URL ?? 'http://localhost:4000/webhooks/alipay',
      privateKey: values.ALIPAY_APP_PRIVATE_KEY ?? '',
      returnUrl:
        values.ALIPAY_RETURN_URL ??
        'http://localhost:3000/payments/{paymentId}/result?provider=alipay',
      sellerId: values.ALIPAY_SELLER_ID ?? '',
    },
    concurrency,
    databaseUrl,
    inboxPollIntervalMs,
    outboxConcurrency,
    outboxPollIntervalMs,
    paypalClientId: values.PAYPAL_CLIENT_ID ?? '',
    paypalClientSecret: values.PAYPAL_CLIENT_SECRET ?? '',
    paymentRecoveryIntervalMs,
    reconciliationIntervalMs,
    reconciliationLookbackMs,
    redisUrl,
    stripeReconciliationKey,
  };
}

function readBoolean(
  value: string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${name} must be true or false.`);
}
