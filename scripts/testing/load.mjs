import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

import databaseModule from '../../packages/database/dist/index.js';

const { createPrismaClient } = databaseModule;
const baseUrl = process.env.PAYFLOW_TEST_BASE_URL ?? 'http://127.0.0.1:4000';
const databaseUrl = required('DATABASE_URL');
const redisUrl = required('REDIS_URL');
const webhookSecret = required('PAYFLOW_TEST_WEBHOOK_SECRET');
const apiPort = new URL(baseUrl).port || '4000';
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const prisma = createPrismaClient(databaseUrl);
const children = new Set();
const reports = [];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function serviceEnvironment(extra = {}) {
  return {
    ...process.env,
    APP_BASE_URL: 'http://localhost:3000',
    DATABASE_URL: databaseUrl,
    JWT_EXPIRES_IN_SECONDS: '900',
    JWT_SECRET: 'payflow-load-test-jwt-secret-2026-rotate',
    NODE_ENV: 'production',
    OTEL_EXPORTER_OTLP_ENDPOINT: '',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',
    PAYPAL_CLIENT_ID: '',
    PAYPAL_CLIENT_SECRET: '',
    PAYPAL_ENV: 'sandbox',
    PAYPAL_WEBHOOK_ID: '',
    PORT: apiPort,
    REDIS_URL: redisUrl,
    STRIPE_RECONCILIATION_KEY: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    ...extra,
  };
}

function startChild(script, extraEnvironment = {}) {
  const stderr = [];
  const child = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env: serviceEnvironment(extraEnvironment),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  children.add(child);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (stderr.join('').length < 8_000) {
      stderr.push(chunk);
    }
  });
  child.once('exit', () => children.delete(child));
  child.loadTestStderr = stderr;
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([once(child, 'exit'), delay(2_000)]);
  }
}

async function startApi() {
  const child = startChild('apps/api/dist/main.js');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `API exited during startup: ${child.loadTestStderr.join('').trim()}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.status === 200) {
        await response.arrayBuffer();
        return child;
      }
    } catch {
      // The listener is not ready yet.
    }
    await delay(100);
  }
  await stopChild(child);
  throw new Error('API did not become healthy within 15 seconds.');
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.token) {
    headers.set('authorization', `Bearer ${options.token}`);
  }
  let body;
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.body);
  } else if (options.rawBody !== undefined) {
    body = options.rawBody;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    body,
    headers,
    method: options.method ?? 'GET',
  });
  const responseBody = await response.arrayBuffer();
  let data = null;
  if (options.parseJson) {
    data = JSON.parse(Buffer.from(responseBody).toString('utf8'));
  }
  return { bytes: responseBody.byteLength, data, status: response.status };
}

async function runLoad(name, total, concurrency, operation) {
  const latencies = [];
  const statuses = new Map();
  const errors = [];
  let bytes = 0;
  let nextIndex = 0;
  const startedAt = performance.now();

  async function runner() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) {
        return;
      }

      const requestStartedAt = performance.now();
      try {
        const result = await operation(index);
        latencies.push(performance.now() - requestStartedAt);
        statuses.set(result.status, (statuses.get(result.status) ?? 0) + 1);
        bytes += result.bytes ?? 0;
      } catch (error) {
        latencies.push(performance.now() - requestStartedAt);
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runner()));
  const wallMs = performance.now() - startedAt;
  const report = {
    avgMs: rounded(
      latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
    ),
    bytes,
    concurrency,
    errors: errors.length,
    name,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    requestsPerSecond: rounded(total / (wallMs / 1_000)),
    statuses: Object.fromEntries(
      [...statuses.entries()].sort(([left], [right]) => left - right),
    ),
    total,
    wallMs: rounded(wallMs),
  };
  reports.push(report);
  console.log(JSON.stringify(report));
  return report;
}

function percentile(values, percentileValue) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return rounded(sorted[index]);
}

function rounded(value) {
  return Number(value.toFixed(2));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stripeSignature(payload) {
  const timestamp = Math.floor(Date.now() / 1_000);
  const digest = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function ignoredStripeEvent(batch, index) {
  return {
    api_version: '2026-07-29.dahlia',
    created: Math.floor(Date.now() / 1_000),
    data: {
      object: { id: `cus_load_${runId}_${batch}_${index}`, object: 'customer' },
    },
    id: `evt_load_${runId}_${batch}_${index}`,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: `load.ignored.${runId}`,
  };
}

function assertReport(report, expectedStatuses, message) {
  const expected = JSON.stringify(expectedStatuses);
  const actual = JSON.stringify(report.statuses);
  if (report.errors !== 0 || actual !== expected) {
    throw new Error(
      `${message}: errors=${report.errors}, statuses=${actual}, expected=${expected}`,
    );
  }
}

async function waitForWebhookDrain(expectedCount) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const [total, ignored, failed, received] = await Promise.all([
      prisma.webhookEvent.count({
        where: { eventType: `load.ignored.${runId}` },
      }),
      prisma.webhookEvent.count({
        where: { eventType: `load.ignored.${runId}`, status: 'IGNORED' },
      }),
      prisma.webhookEvent.count({
        where: { eventType: `load.ignored.${runId}`, status: 'FAILED' },
      }),
      prisma.webhookEvent.count({
        where: { eventType: `load.ignored.${runId}`, status: 'RECEIVED' },
      }),
    ]);
    if (
      total === expectedCount &&
      ignored === expectedCount &&
      failed === 0 &&
      received === 0
    ) {
      return;
    }
    await delay(100);
  }
  throw new Error('Webhook queue did not fully drain within 60 seconds.');
}

async function main() {
  await prisma.$connect();

  let api = await startApi();
  const products = await request('/products', { parseJson: true });
  const productId = products.data?.items?.[0]?.id;
  if (products.status !== 200 || !productId) {
    throw new Error('Seeded products are unavailable.');
  }

  const email = `load-${runId}@example.com`;
  const registration = await request('/auth/register', {
    body: { email, password: 'Load-Test-2026!' },
    method: 'POST',
    parseJson: true,
  });
  const userToken = registration.data?.accessToken;
  if (registration.status !== 201 || !userToken) {
    throw new Error(
      `Load-test user registration failed with HTTP ${registration.status}.`,
    );
  }

  const orderWrites = await runLoad('orders-write-burst', 100, 50, () =>
    request('/orders', {
      body: { items: [{ productId, quantity: 1 }] },
      method: 'POST',
      token: userToken,
    }),
  );
  assertReport(orderWrites, { 201: 100 }, 'Order write burst failed');
  await stopChild(api);

  api = await startApi();
  const orderReads = await runLoad('orders-unbounded-list-read', 100, 50, () =>
    request('/orders', { token: userToken }),
  );
  assertReport(orderReads, { 200: 100 }, 'Order list read burst failed');
  await stopChild(api);

  api = await startApi();
  const productReads = await runLoad('products-read-at-limit', 120, 60, () =>
    request('/products'),
  );
  assertReport(productReads, { 200: 120 }, 'Product read burst failed');
  const throttle = await runLoad('health-overload-protection', 300, 50, () =>
    request('/health'),
  );
  assertReport(
    throttle,
    { 200: 120, 429: 180 },
    'Global throttling did not fail predictably',
  );
  await stopChild(api);

  const worker = startChild('apps/worker/dist/main.js', {
    OUTBOX_POLL_INTERVAL_MS: '500',
    RECONCILIATION_INTERVAL_MS: '3600000',
    RECONCILIATION_LOOKBACK_MS: '3600000',
    WEBHOOK_WORKER_CONCURRENCY: '8',
  });
  await delay(1_000);
  if (worker.exitCode !== null) {
    throw new Error(
      `Worker exited during startup: ${worker.loadTestStderr.join('').trim()}`,
    );
  }

  const webhookBatchReports = [];
  const webhookBatches = 10;
  const webhookBatchSize = 100;
  for (let batch = 0; batch < webhookBatches; batch += 1) {
    api = await startApi();
    const report = await runLoad(
      `webhook-ingest-${batch + 1}`,
      webhookBatchSize,
      50,
      (index) => {
        const rawBody = JSON.stringify(ignoredStripeEvent(batch, index));
        return request('/webhooks/stripe', {
          headers: {
            'content-type': 'application/json',
            'stripe-signature': stripeSignature(rawBody),
          },
          method: 'POST',
          rawBody,
        });
      },
    );
    assertReport(
      report,
      { 200: webhookBatchSize },
      `Webhook batch ${batch + 1} failed`,
    );
    webhookBatchReports.push(report);
    await stopChild(api);
  }

  const drainStartedAt = performance.now();
  await waitForWebhookDrain(webhookBatches * webhookBatchSize);
  const drainWaitMs = performance.now() - drainStartedAt;
  const webhookRows = await prisma.webhookEvent.findMany({
    where: { eventType: `load.ignored.${runId}` },
    select: {
      deliveryCount: true,
      processedAt: true,
      processingAttempts: true,
      receivedAt: true,
      status: true,
    },
  });
  const endToEndLatencies = webhookRows.map(
    (row) => row.processedAt.getTime() - row.receivedAt.getTime(),
  );
  const webhookReport = {
    accepted: webhookRows.length,
    deliveryCountExactlyOne: webhookRows.filter(
      (row) => row.deliveryCount === 1,
    ).length,
    drainWaitAfterIngestMs: rounded(drainWaitMs),
    failed: webhookRows.filter((row) => row.status === 'FAILED').length,
    httpAverageRps: rounded(
      webhookBatchReports.reduce(
        (sum, report) => sum + report.requestsPerSecond,
        0,
      ) / webhookBatchReports.length,
    ),
    httpP95Ms: rounded(
      webhookBatchReports.reduce((sum, report) => sum + report.p95Ms, 0) /
        webhookBatchReports.length,
    ),
    ignored: webhookRows.filter((row) => row.status === 'IGNORED').length,
    name: 'webhook-api-db-redis-worker',
    processingAttemptsExactlyOne: webhookRows.filter(
      (row) => row.processingAttempts === 1,
    ).length,
    queueEndToEndP50Ms: percentile(endToEndLatencies, 50),
    queueEndToEndP95Ms: percentile(endToEndLatencies, 95),
    queueEndToEndP99Ms: percentile(endToEndLatencies, 99),
  };
  console.log(JSON.stringify(webhookReport));
  if (
    webhookReport.accepted !== webhookBatches * webhookBatchSize ||
    webhookReport.ignored !== webhookBatches * webhookBatchSize ||
    webhookReport.failed !== 0 ||
    webhookReport.deliveryCountExactlyOne !==
      webhookBatches * webhookBatchSize ||
    webhookReport.processingAttemptsExactlyOne !==
      webhookBatches * webhookBatchSize
  ) {
    throw new Error(
      `Webhook pressure invariants failed: ${JSON.stringify(webhookReport)}`,
    );
  }
  await stopChild(worker);

  api = await startApi();
  const recoveryHealth = await request('/health', { parseJson: true });
  if (
    recoveryHealth.status !== 200 ||
    recoveryHealth.data?.checks?.database !== 'up' ||
    recoveryHealth.data?.checks?.redis !== 'up'
  ) {
    throw new Error(
      `Post-load health gate failed with HTTP ${recoveryHealth.status}.`,
    );
  }
  await stopChild(api);

  const loadUser = await prisma.user.findUnique({
    where: { email },
    select: { _count: { select: { orders: true } } },
  });
  if (loadUser?._count.orders !== 100) {
    throw new Error(
      `Expected 100 committed load-test orders, found ${loadUser?._count.orders ?? 0}.`,
    );
  }

  console.log(
    JSON.stringify({
      checks: {
        committedOrders: loadUser._count.orders,
        postLoadHealth: 'up',
        transportErrors: reports.reduce(
          (sum, report) => sum + report.errors,
          0,
        ),
        webhookInvariants: 'preserved',
      },
      result: 'PASS',
      runId,
    }),
  );
}

try {
  await main();
} finally {
  await Promise.all([...children].map((child) => stopChild(child)));
  await prisma.$disconnect();
}
