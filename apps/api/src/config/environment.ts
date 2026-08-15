export type NodeEnvironment = 'development' | 'test' | 'production';

export interface ApiEnvironment {
  ALIPAY_ALLOW_PRODUCTION: boolean;
  ALIPAY_ALIPAY_PUBLIC_CERT_CONTENT: string;
  ALIPAY_ALIPAY_ROOT_CERT_CONTENT: string;
  ALIPAY_APP_CERT_CONTENT: string;
  ALIPAY_APP_ID: string;
  ALIPAY_APP_PRIVATE_KEY: string;
  ALIPAY_ENABLED: boolean;
  ALIPAY_ENV: 'production' | 'sandbox';
  ALIPAY_GATEWAY_URL: string;
  ALIPAY_NOTIFY_URL: string;
  ALIPAY_PUBLIC_KEY: string;
  ALIPAY_RETURN_URL: string;
  ALIPAY_SELLER_ID: string;
  APP_BASE_URL: string;
  DATABASE_URL: string;
  ENABLE_SWAGGER: boolean;
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
  const enableSwagger = readBoolean(values, 'ENABLE_SWAGGER', false);
  const alipayEnabled = readBoolean(values, 'ALIPAY_ENABLED', false);
  const alipayAllowProduction = readBoolean(
    values,
    'ALIPAY_ALLOW_PRODUCTION',
    false,
  );
  const alipayEnvironment = readString(values, 'ALIPAY_ENV', 'sandbox');
  const alipayGatewayUrl = readString(
    values,
    'ALIPAY_GATEWAY_URL',
    alipayEnvironment === 'production'
      ? 'https://openapi.alipay.com/gateway.do'
      : 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
  );

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

  if (!new Set(['sandbox', 'production']).has(alipayEnvironment)) {
    throw new Error('ALIPAY_ENV must be sandbox or production.');
  }
  if (alipayEnvironment === 'production' && !alipayAllowProduction) {
    throw new Error(
      'ALIPAY production mode requires ALIPAY_ALLOW_PRODUCTION=true.',
    );
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
    ALIPAY_ALLOW_PRODUCTION: alipayAllowProduction,
    ALIPAY_ALIPAY_PUBLIC_CERT_CONTENT: readString(
      values,
      'ALIPAY_ALIPAY_PUBLIC_CERT_CONTENT',
      '',
    ),
    ALIPAY_ALIPAY_ROOT_CERT_CONTENT: readString(
      values,
      'ALIPAY_ALIPAY_ROOT_CERT_CONTENT',
      '',
    ),
    ALIPAY_APP_CERT_CONTENT: readString(values, 'ALIPAY_APP_CERT_CONTENT', ''),
    ALIPAY_APP_ID: readString(values, 'ALIPAY_APP_ID', ''),
    ALIPAY_APP_PRIVATE_KEY: readString(values, 'ALIPAY_APP_PRIVATE_KEY', ''),
    ALIPAY_ENABLED: alipayEnabled,
    ALIPAY_ENV: alipayEnvironment as 'production' | 'sandbox',
    ALIPAY_GATEWAY_URL: alipayGatewayUrl,
    ALIPAY_NOTIFY_URL: readString(
      values,
      'ALIPAY_NOTIFY_URL',
      `http://localhost:${port}/webhooks/alipay`,
    ),
    ALIPAY_PUBLIC_KEY: readString(values, 'ALIPAY_PUBLIC_KEY', ''),
    ALIPAY_RETURN_URL: readString(
      values,
      'ALIPAY_RETURN_URL',
      `${appBaseUrl.replace(/\/$/, '')}/payments/{paymentId}/result?provider=alipay`,
    ),
    ALIPAY_SELLER_ID: readString(values, 'ALIPAY_SELLER_ID', ''),
    APP_BASE_URL: appBaseUrl,
    DATABASE_URL: databaseUrl,
    ENABLE_SWAGGER: enableSwagger,
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

function readBoolean(
  values: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = values[key];
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${key} must be true or false.`);
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
