export type NodeEnvironment = 'development' | 'test' | 'production';

export interface ApiEnvironment {
  APP_BASE_URL: string;
  DATABASE_URL: string;
  JWT_EXPIRES_IN_SECONDS: number;
  JWT_SECRET: string;
  NODE_ENV: NodeEnvironment;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_ENV: 'sandbox';
  PAYPAL_WEBHOOK_ID: string;
  PORT: number;
  REDIS_URL: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

const allowedNodeEnvironments = new Set<NodeEnvironment>([
  'development',
  'test',
  'production',
]);

export function validateEnvironment(
  values: Record<string, unknown>,
): ApiEnvironment & Record<string, unknown> {
  const nodeEnvironment = readString(values, 'NODE_ENV', 'development');
  const databaseUrl = readString(values, 'DATABASE_URL', '');
  const appBaseUrl = readString(
    values,
    'APP_BASE_URL',
    'http://localhost:3000',
  );
  const port = Number(values.PORT ?? 4000);
  const jwtSecret = readString(values, 'JWT_SECRET', '');
  const jwtExpiresInSeconds = Number(values.JWT_EXPIRES_IN_SECONDS ?? 900);
  const stripeSecretKey = readString(values, 'STRIPE_SECRET_KEY', '');
  const stripeWebhookSecret = readString(values, 'STRIPE_WEBHOOK_SECRET', '');
  const redisUrl = readString(values, 'REDIS_URL', 'redis://localhost:6379');
  const paypalClientId = readString(values, 'PAYPAL_CLIENT_ID', '');
  const paypalClientSecret = readString(values, 'PAYPAL_CLIENT_SECRET', '');
  const paypalWebhookId = readString(values, 'PAYPAL_WEBHOOK_ID', '');
  const paypalEnvironment = readString(values, 'PAYPAL_ENV', 'sandbox');

  if (!allowedNodeEnvironments.has(nodeEnvironment as NodeEnvironment)) {
    throw new Error(
      'NODE_ENV must be one of development, test, or production.',
    );
  }

  if (!databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  }

  if (
    !Number.isInteger(jwtExpiresInSeconds) ||
    jwtExpiresInSeconds < 300 ||
    jwtExpiresInSeconds > 86_400
  ) {
    throw new Error(
      'JWT_EXPIRES_IN_SECONDS must be an integer between 300 and 86400.',
    );
  }

  if (
    stripeSecretKey &&
    !stripeSecretKey.startsWith('sk_test_') &&
    !stripeSecretKey.startsWith('rk_test_')
  ) {
    throw new Error(
      'STRIPE_SECRET_KEY must be a Stripe test or sandbox key; live keys are forbidden.',
    );
  }

  if (stripeWebhookSecret && !stripeWebhookSecret.startsWith('whsec_')) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret.',
    );
  }

  if (paypalEnvironment !== 'sandbox') {
    throw new Error('PAYPAL_ENV must be sandbox; live mode is forbidden.');
  }

  try {
    const parsedRedisUrl = new URL(redisUrl);
    if (!new Set(['redis:', 'rediss:']).has(parsedRedisUrl.protocol)) {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error('REDIS_URL must be a redis:// or rediss:// URL.');
  }

  try {
    new URL(appBaseUrl);
  } catch {
    throw new Error('APP_BASE_URL must be a valid URL.');
  }

  return {
    ...values,
    APP_BASE_URL: appBaseUrl,
    DATABASE_URL: databaseUrl,
    JWT_EXPIRES_IN_SECONDS: jwtExpiresInSeconds,
    JWT_SECRET: jwtSecret,
    NODE_ENV: nodeEnvironment as NodeEnvironment,
    PAYPAL_CLIENT_ID: paypalClientId,
    PAYPAL_CLIENT_SECRET: paypalClientSecret,
    PAYPAL_ENV: 'sandbox',
    PAYPAL_WEBHOOK_ID: paypalWebhookId,
    PORT: port,
    REDIS_URL: redisUrl,
    STRIPE_SECRET_KEY: stripeSecretKey,
    STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
  };
}

function readString(
  values: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = values[key];

  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string.`);
  }

  return value;
}
