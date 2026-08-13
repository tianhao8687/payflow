import { createHmac, randomUUID } from 'node:crypto';

const baseUrl = process.env.PAYFLOW_TEST_BASE_URL ?? 'http://localhost:4000';
const adminEmail = required('PAYFLOW_TEST_ADMIN_EMAIL');
const adminPassword = required('PAYFLOW_TEST_ADMIN_PASSWORD');
const webhookSecret = required('PAYFLOW_TEST_WEBHOOK_SECRET');
const results = [];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.token) {
    headers.set('authorization', `Bearer ${options.token}`);
  }

  let body = options.rawBody;
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    body,
    headers,
    method: options.method ?? 'GET',
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    data,
    durationMs: performance.now() - startedAt,
    headers: response.headers,
    status: response.status,
  };
}

function record(name, passed, evidence) {
  results.push({ evidence, name, passed });
  const marker = passed ? 'PASS' : 'FAIL';
  console.log(`${marker} ${name} :: ${evidence}`);
}

function statusIs(name, response, expected) {
  record(
    name,
    response.status === expected,
    `HTTP ${response.status}, expected ${expected}`,
  );
}

function signature(payload, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function stripeEvent({
  id = `evt_adv_${randomUUID()}`,
  livemode = false,
  object,
  type,
}) {
  return {
    api_version: '2026-07-29.dahlia',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: object ?? { id: `obj_${randomUUID()}`, object: 'customer' },
    },
    id,
    livemode,
    object: 'event',
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
  };
}

async function sendStripe(event, timestamp) {
  const rawBody = JSON.stringify(event);
  return request('/webhooks/stripe', {
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature(rawBody, timestamp),
    },
    method: 'POST',
    rawBody,
  });
}

async function pollWebhook(
  adminToken,
  eventType,
  predicate,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await request(
      `/admin/webhooks?eventType=${encodeURIComponent(eventType)}&pageSize=100`,
      { token: adminToken },
    );
    const item = response.data?.items?.find(
      (candidate) => candidate.eventType === eventType,
    );
    if (response.status === 200 && item && predicate(item)) {
      return item;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function noneJwt() {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      aud: 'payflow-api',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'payflow',
      role: 'ADMIN',
      sub: randomUUID(),
    }),
  ).toString('base64url');
  return `${header}.${payload}.`;
}

async function main() {
  const health = await request('/health');
  statusIs('dependency health gate', health, 200);

  const adminLogin = await request('/auth/login', {
    body: { email: adminEmail, password: adminPassword },
    method: 'POST',
  });
  statusIs('admin fixture authentication', adminLogin, 200);
  const adminToken = adminLogin.data?.accessToken;
  if (!adminToken) {
    throw new Error('Admin login did not return an access token.');
  }

  const malformedJson = await request('/auth/login', {
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    rawBody: '{"email":',
  });
  statusIs('malformed JSON rejected', malformedJson, 400);

  const roleInjectionEmail = `role-injection-${Date.now()}@example.com`;
  const roleInjection = await request('/auth/register', {
    body: {
      email: roleInjectionEmail,
      password: 'Adversarial-2026!',
      role: 'ADMIN',
    },
    method: 'POST',
  });
  statusIs('registration mass-assignment rejected', roleInjection, 400);

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const password = 'Adversarial-2026!';
  const userARegistration = await request('/auth/register', {
    body: { email: `adversarial-a-${suffix}@example.com`, password },
    method: 'POST',
  });
  const userBRegistration = await request('/auth/register', {
    body: { email: `adversarial-b-${suffix}@example.com`, password },
    method: 'POST',
  });
  statusIs('user A fixture registration', userARegistration, 201);
  statusIs('user B fixture registration', userBRegistration, 201);
  const userAToken = userARegistration.data?.accessToken;
  const userBToken = userBRegistration.data?.accessToken;
  if (!userAToken || !userBToken) {
    throw new Error('User registration did not return access tokens.');
  }
  record(
    'public registration cannot choose role',
    userARegistration.data?.user?.role === 'USER' &&
      userBRegistration.data?.user?.role === 'USER',
    `roles=${userARegistration.data?.user?.role}/${userBRegistration.data?.user?.role}`,
  );

  statusIs('missing JWT rejected', await request('/orders'), 401);
  statusIs(
    'malformed Bearer header rejected',
    await request('/orders', {
      headers: { authorization: `Bearer ${userAToken} extra` },
    }),
    401,
  );
  statusIs(
    'alg=none JWT rejected',
    await request('/orders', { token: noneJwt() }),
    401,
  );
  const tamperedJwt = `${userAToken.slice(0, -1)}${userAToken.endsWith('a') ? 'b' : 'a'}`;
  statusIs(
    'tampered JWT rejected',
    await request('/orders', { token: tamperedJwt }),
    401,
  );

  const products = await request('/products');
  statusIs('product fixture available', products, 200);
  const productId = products.data?.items?.[0]?.id;
  if (!productId) {
    throw new Error('No seeded product was returned.');
  }

  const orderMassAssignment = await request('/orders', {
    body: { items: [{ productId, quantity: 1 }], userId: randomUUID() },
    method: 'POST',
    token: userAToken,
  });
  statusIs(
    'order ownership mass-assignment rejected',
    orderMassAssignment,
    400,
  );

  const orderCreation = await request('/orders', {
    body: { items: [{ productId, quantity: 1 }] },
    method: 'POST',
    token: userAToken,
  });
  statusIs('owned order fixture creation', orderCreation, 201);
  const orderId = orderCreation.data?.id;
  if (!orderId) {
    throw new Error('Order creation did not return an ID.');
  }

  statusIs(
    'cross-tenant order read hidden',
    await request(`/orders/${orderId}`, { token: userBToken }),
    404,
  );
  statusIs(
    'cross-tenant order mutation hidden',
    await request(`/orders/${orderId}/cancel`, {
      method: 'POST',
      token: userBToken,
    }),
    404,
  );
  statusIs(
    'owner can read order',
    await request(`/orders/${orderId}`, { token: userAToken }),
    200,
  );
  statusIs(
    'USER cannot access admin API',
    await request('/admin/dashboard', { token: userAToken }),
    403,
  );
  statusIs(
    'invalid UUID rejected before repository',
    await request('/orders/not-a-uuid', { token: userAToken }),
    400,
  );

  const injectionQuery = await request(
    `/admin/orders?query=${encodeURIComponent("' OR 1=1 --")}&pageSize=100`,
    { token: adminToken },
  );
  record(
    'admin search input remains parameterized',
    injectionQuery.status === 200 && injectionQuery.data?.total === 0,
    `HTTP ${injectionQuery.status}, total=${injectionQuery.data?.total ?? 'n/a'}`,
  );

  const beforeInvalid = await request('/admin/webhooks?pageSize=1', {
    token: adminToken,
  });
  const invalidSignature = await request('/webhooks/stripe', {
    body: stripeEvent({ type: 'customer.created' }),
    headers: { 'stripe-signature': 't=1,v1=invalid' },
    method: 'POST',
  });
  statusIs('invalid Stripe signature rejected', invalidSignature, 400);
  const afterInvalid = await request('/admin/webhooks?pageSize=1', {
    token: adminToken,
  });
  record(
    'invalid signature causes no persistence',
    beforeInvalid.data?.total === afterInvalid.data?.total,
    `webhook rows ${beforeInvalid.data?.total} -> ${afterInvalid.data?.total}`,
  );

  const oldEvent = stripeEvent({ type: `adversarial.old.${randomUUID()}` });
  const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
  statusIs(
    'expired Stripe signature rejected',
    await sendStripe(oldEvent, oldTimestamp),
    400,
  );

  const liveType = `adversarial.live.${randomUUID()}`;
  const liveEvent = stripeEvent({ livemode: true, type: liveType });
  statusIs(
    'signed live-mode event acknowledged for async quarantine',
    await sendStripe(liveEvent),
    200,
  );
  const liveRecord = await pollWebhook(
    adminToken,
    liveType,
    (item) => item.status === 'FAILED',
  );
  record(
    'live-mode rejection is auditable',
    Boolean(liveRecord),
    liveRecord ? `status=${liveRecord.status}` : 'no FAILED audit row observed',
  );

  const replayType = `adversarial.replay.${randomUUID()}`;
  const replayEvent = stripeEvent({ type: replayType });
  const replayResponses = await Promise.all(
    Array.from({ length: 5 }, () => sendStripe(replayEvent)),
  );
  const replayStatuses = replayResponses.map((response) => response.status);
  const originalCount = replayResponses.filter(
    (response) => response.data?.duplicate === false,
  ).length;
  const duplicateCount = replayResponses.filter(
    (response) => response.data?.duplicate === true,
  ).length;
  record(
    'concurrent signed replay deduplicated',
    replayStatuses.every((status) => status === 200) &&
      originalCount === 1 &&
      duplicateCount === 4,
    `HTTP=${replayStatuses.join('/')}, originals=${originalCount}, duplicates=${duplicateCount}`,
  );
  const replayRecord = await pollWebhook(
    adminToken,
    replayType,
    (item) => item.deliveryCount === 5 && item.status === 'IGNORED',
  );
  record(
    'replay delivery count retained with one terminal state',
    Boolean(replayRecord),
    replayRecord
      ? `deliveryCount=${replayRecord.deliveryCount}, status=${replayRecord.status}`
      : 'terminal replay row not observed',
  );

  const payments = await request('/admin/payments?pageSize=100', {
    token: adminToken,
  });
  const settledPayment = payments.data?.items?.find((item) =>
    ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(item.status),
  );
  if (settledPayment) {
    const forgedType = `payment_intent.succeeded`;
    const forgedId = `evt_adv_forged_${randomUUID()}`;
    const forgedEvent = stripeEvent({
      id: forgedId,
      object: {
        amount: settledPayment.amount + 1,
        currency: settledPayment.currency.toLowerCase(),
        id: settledPayment.providerPaymentId ?? `pi_adv_${randomUUID()}`,
        metadata: {
          orderId: settledPayment.orderId,
          paymentId: settledPayment.id,
        },
        object: 'payment_intent',
      },
      type: forgedType,
    });
    const beforeStatus = settledPayment.status;
    statusIs(
      'signed domain-tampering event accepted for async validation',
      await sendStripe(forgedEvent),
      200,
    );
    const forgedRecord = await pollWebhook(
      adminToken,
      forgedType,
      (item) => item.providerEventId === forgedId && item.status === 'FAILED',
    );
    const paymentAfter = await request(`/admin/payments/${settledPayment.id}`, {
      token: adminToken,
    });
    record(
      'amount-tampering event fails domain validation without mutation',
      Boolean(forgedRecord) && paymentAfter.data?.status === beforeStatus,
      `webhook=${forgedRecord?.status ?? 'not-observed'}, payment=${beforeStatus}->${paymentAfter.data?.status ?? 'n/a'}`,
    );
  } else {
    record(
      'amount-tampering event fails domain validation without mutation',
      false,
      'no settled fixture payment',
    );
  }

  const oversized = await request('/orders', {
    body: {
      items: [{ productId, quantity: 1 }],
      padding: 'x'.repeat(130 * 1024),
    },
    method: 'POST',
    token: userAToken,
  });
  statusIs('oversized JSON rejected as payload-too-large', oversized, 413);

  const rateLimitResponses = [];
  for (let index = 0; index < 7; index += 1) {
    rateLimitResponses.push(
      await request('/auth/login', {
        body: { email: `no-such-user-${suffix}@example.com`, password },
        headers: { 'x-forwarded-for': `198.51.100.${index + 1}` },
        method: 'POST',
      }),
    );
  }
  const limitedCount = rateLimitResponses.filter(
    (response) => response.status === 429,
  ).length;
  record(
    'rotating X-Forwarded-For cannot bypass login throttling',
    limitedCount >= 1,
    `statuses=${rateLimitResponses.map((response) => response.status).join('/')}`,
  );

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  console.log(JSON.stringify({ failed, passed, total: results.length }));
  if (failed > 0) {
    process.exitCode = 1;
  }
}

await main();
