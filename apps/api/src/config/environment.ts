export type NodeEnvironment = 'development' | 'test' | 'production';

export interface ApiEnvironment {
  APP_BASE_URL: string;
  DATABASE_URL: string;
  JWT_EXPIRES_IN_SECONDS: number;
  JWT_SECRET: string;
  NODE_ENV: NodeEnvironment;
  PORT: number;
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
    PORT: port,
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
