import 'dotenv/config';

import { createPrismaClient } from '@payflow/database';
import { PaymentProviderRegistry } from '@payflow/payment-core';
import { PayPalProvider } from '@payflow/payment-paypal';
import { StripeProvider } from '@payflow/payment-stripe';

import { startWebhookWorker } from './worker-runtime';

async function bootstrap(): Promise<void> {
  const environment = readEnvironment(process.env);
  const prisma = createPrismaClient(environment.databaseUrl);
  const providers = new PaymentProviderRegistry([
    new StripeProvider({
      appName: 'PayFlow Worker',
      appVersion: '0.8.0',
      secretKey: '',
      webhookSecret: '',
    }),
    new PayPalProvider({
      clientId: environment.paypalClientId,
      clientSecret: environment.paypalClientSecret,
      webhookId: '',
    }),
  ]);

  await prisma.$connect();
  const worker = startWebhookWorker({
    concurrency: environment.concurrency,
    prisma,
    providers,
    redisUrl: environment.redisUrl,
  });

  worker.on('ready', () => {
    console.info('PayFlow webhook worker is ready.');
  });
  worker.on('failed', (job, error) => {
    console.error('PayFlow webhook job failed.', {
      attemptsMade: job?.attemptsMade,
      jobId: job?.id,
      message: error.message,
    });
  });
  worker.on('error', (error) => {
    console.error('PayFlow webhook worker error.', { message: error.message });
  });

  let closing = false;
  async function shutdown(): Promise<void> {
    if (closing) {
      return;
    }
    closing = true;
    await worker.close();
    await prisma.$disconnect();
  }

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void bootstrap();

interface WorkerEnvironment {
  concurrency: number;
  databaseUrl: string;
  paypalClientId: string;
  paypalClientSecret: string;
  redisUrl: string;
}

function readEnvironment(values: NodeJS.ProcessEnv): WorkerEnvironment {
  const databaseUrl = values.DATABASE_URL ?? '';
  const redisUrl = values.REDIS_URL ?? '';
  const concurrency = Number(values.WEBHOOK_WORKER_CONCURRENCY ?? 8);

  if (!databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
    throw new Error('REDIS_URL must be a Redis connection URL.');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new Error('WEBHOOK_WORKER_CONCURRENCY must be between 1 and 64.');
  }
  if ((values.PAYPAL_ENV ?? 'sandbox') !== 'sandbox') {
    throw new Error(
      'Only PayPal sandbox mode is allowed in this implementation.',
    );
  }

  return {
    concurrency,
    databaseUrl,
    paypalClientId: values.PAYPAL_CLIENT_ID ?? '',
    paypalClientSecret: values.PAYPAL_CLIENT_SECRET ?? '',
    redisUrl,
  };
}
