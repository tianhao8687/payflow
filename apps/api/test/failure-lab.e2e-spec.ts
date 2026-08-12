import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PaymentAttemptStatus,
  PaymentStatus,
  RefundStatus as DatabaseRefundStatus,
} from '@payflow/database';
import {
  type CreatePaymentInput,
  type CreatePaymentResult,
  PAYMENT_PROVIDER,
  PAYMENT_PROVIDER_REGISTRY,
  type PaymentProvider,
  PaymentProviderRegistry,
  PaymentProviderError,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  type RefundPaymentInput,
  type RefundPaymentResult,
} from '@payflow/payment-core';
import { StripeProvider } from '@payflow/payment-stripe';
import type { WebhookWorker } from '@payflow/payment-queue';
import request from 'supertest';
import { App } from 'supertest/types';
import Stripe from 'stripe';

import { AppModule } from './../src/app.module';
import { AuthResponseDto } from './../src/auth/dto/auth-response.dto';
import { DatabaseService } from './../src/database/database.service';
import { ApiExceptionFilter } from './../src/http/api-exception.filter';
import { OrderResponseDto } from './../src/orders/dto/order-response.dto';
import { CheckoutSessionResponseDto } from './../src/payments/dto/payment-response.dto';
import { ProductListResponseDto } from './../src/products/dto/product-list-response.dto';
import { CreateRefundResponseDto } from './../src/refunds/dto/refund-response.dto';
import { WebhookResponseDto } from './../src/webhooks/dto/webhook-response.dto';
import { WebhooksRepository } from './../src/webhooks/webhooks.repository';
import {
  startTestWebhookWorker,
  waitForWebhookStatus,
} from './webhook-worker-harness';

interface ErrorResponse {
  code: string;
}

interface LabFixture {
  amount: number;
  currency: string;
  orderId: string;
  paymentId: string;
  providerPaymentId: string;
}

class FailureLabPaymentOperations {
  readonly inputs: CreatePaymentInput[] = [];
  private failAcceptedOperation = false;
  private readonly sessions = new Map<string, CreatePaymentResult>();

  isConfigured(): boolean {
    return true;
  }

  failNextAfterProviderAcceptance(): void {
    this.failAcceptedOperation = true;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.inputs.push(input);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const replay = this.sessions.get(input.idempotencyKey);
    if (replay) {
      return replay;
    }

    const sequence = this.sessions.size + 1;
    const result: CreatePaymentResult = {
      amount: input.amount,
      currency: input.currency,
      expiresAt: new Date(Date.now() + 86_400_000),
      providerCheckoutSessionId: `cs_test_failure_lab_${sequence}`,
      providerPaymentId: null,
      providerRequestId: `req_failure_lab_${sequence}`,
      redirectUrl: `https://checkout.stripe.test/c/failure_lab_${sequence}`,
      status: ProviderPaymentStatus.PENDING,
    };
    this.sessions.set(input.idempotencyKey, result);

    if (this.failAcceptedOperation) {
      this.failAcceptedOperation = false;
      throw new PaymentProviderError(
        'STRIPE',
        'CREATE_PAYMENT',
        'StripeConnectionError',
        'The provider accepted the request but the response was lost.',
      );
    }

    return result;
  }

  get uniqueOperationCount(): number {
    return this.sessions.size;
  }
}

class FailureLabRefundOperations {
  readonly inputs: RefundPaymentInput[] = [];
  private blockedOperation:
    | {
        entered: Promise<void>;
        markEntered: () => void;
        released: Promise<void>;
      }
    | undefined;
  private readonly refunds = new Map<string, RefundPaymentResult>();

  isConfigured(): boolean {
    return true;
  }

  blockNextNewOperation(): { entered: Promise<void>; release: () => void } {
    let markEntered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.blockedOperation = { entered, markEntered, released };

    return { entered, release };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    this.inputs.push(input);

    const replay = this.refunds.get(input.idempotencyKey);
    if (replay) {
      return replay;
    }

    const sequence = this.refunds.size + 1;
    const result: RefundPaymentResult = {
      amount: input.amount,
      currency: 'USD',
      failureCode: null,
      failureMessage: null,
      providerPaymentId: input.providerPaymentId,
      providerRefundId: `re_failure_lab_${sequence}`,
      providerRequestId: `req_refund_failure_lab_${sequence}`,
      status: ProviderRefundStatus.SUCCEEDED,
    };
    this.refunds.set(input.idempotencyKey, result);

    const blocked = this.blockedOperation;
    if (blocked) {
      this.blockedOperation = undefined;
      blocked.markEntered();
      await blocked.released;
    }

    return result;
  }

  get uniqueOperationCount(): number {
    return this.refunds.size;
  }
}

describe('PayFlow Stage 6 Failure Lab (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let webhookWorker: WebhookWorker;
  let userToken: string;
  let adminToken: string;
  let productId: string;
  const runId = Date.now();
  const userEmail = `failure-lab-${runId}@example.com`;
  const userPassword = 'Failure-lab-sandbox-2026!';
  const eventPrefix = `evt_payflow_failure_lab_${runId}`;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;
  const orderIds: string[] = [];
  const fakeCheckout = new FailureLabPaymentOperations();
  const fakeRefund = new FailureLabRefundOperations();
  const stripeVerifier = new StripeProvider({
    secretKey: 'sk_test_payflow_failure_lab_adapter_only',
    webhookSecret,
  });
  const fakeProvider: PaymentProvider = {
    createPayment: (input) => fakeCheckout.createPayment(input),
    getPayment: () =>
      Promise.reject(new Error('Provider lookup is not used in this suite.')),
    isConfigured: () => true,
    name: 'STRIPE',
    refundPayment: (input) => fakeRefund.refundPayment(input),
    verifyWebhook: (input) => stripeVerifier.verifyWebhook(input),
  };
  const atomicityConstraint = 'failure_lab_reject_paid_transition';

  beforeAll(async () => {
    const moduleFixture = await createTestingModule();
    app = configureApplication(
      moduleFixture.createNestApplication({
        rawBody: true,
      }),
    );
    await app.init();
    database = app.get(DatabaseService);
    webhookWorker = startTestWebhookWorker(
      database,
      app.get<PaymentProviderRegistry>(PAYMENT_PROVIDER_REGISTRY),
    );
    await webhookWorker.waitUntilReady();
    await dropAtomicityConstraint();

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: userEmail, password: userPassword })
      .expect(201);
    userToken = (registration.body as unknown as AuthResponseDto).accessToken;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: process.env.PAYFLOW_ADMIN_EMAIL,
        password: process.env.PAYFLOW_ADMIN_PASSWORD,
      })
      .expect(200);
    adminToken = (adminLogin.body as unknown as AuthResponseDto).accessToken;

    const products = await request(app.getHttpServer())
      .get('/products')
      .expect(200);
    const firstProduct = (products.body as unknown as ProductListResponseDto)
      .items[0];
    if (!firstProduct) {
      throw new Error('Failure Lab requires the committed product seed.');
    }
    productId = firstProduct.id;
  });

  it('01 — five payment clicks converge on one provider operation', async () => {
    const order = await createOrder();
    const inputStart = fakeCheckout.inputs.length;
    const providerStart = fakeCheckout.uniqueOperationCount;
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/payments/checkout-session')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ orderId: order.id })
          .expect(201),
      ),
    );
    const bodies = responses.map(
      (response) => response.body as unknown as CheckoutSessionResponseDto,
    );

    expect(new Set(bodies.map((body) => body.payment.id)).size).toBe(1);
    expect(
      new Set(bodies.map((body) => body.payment.providerCheckoutSessionId))
        .size,
    ).toBe(1);
    expect(fakeCheckout.uniqueOperationCount).toBe(providerStart + 1);
    expect(
      new Set(
        fakeCheckout.inputs
          .slice(inputStart)
          .map((input) => input.idempotencyKey),
      ),
    ).toEqual(new Set([`payment:create:stripe:${order.id}:1`]));
    await expect(
      database.prisma.payment.count({ where: { orderId: order.id } }),
    ).resolves.toBe(1);
  });

  it('02 — five identical webhooks change payment state once', async () => {
    const fixture = await createCheckoutFixture();
    const eventId = `${eventPrefix}_02_duplicate`;
    const event = paymentIntentEvent(fixture, eventId, 'succeeded');
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => sendWebhook(app, event).expect(200)),
    );
    const bodies = responses.map(
      (response) => response.body as unknown as WebhookResponseDto,
    );

    expect(bodies.filter((body) => !body.duplicate)).toHaveLength(1);
    expect(bodies.filter((body) => body.duplicate)).toHaveLength(4);
    await waitForWebhookStatus(database, eventId, 'PROCESSED');
    await expect(
      database.prisma.webhookEvent.findUniqueOrThrow({
        where: {
          provider_providerEventId: {
            provider: 'STRIPE',
            providerEventId: eventId,
          },
        },
        select: { deliveryCount: true, status: true },
      }),
    ).resolves.toEqual({ deliveryCount: 5, status: 'PROCESSED' });
    await expect(readPaymentAndOrder(fixture)).resolves.toEqual({
      orderStatus: 'PAID',
      paymentStatus: 'SUCCEEDED',
    });
  });

  it('03 — a stale failure after success cannot regress state', async () => {
    const fixture = await createCheckoutFixture();
    const successEventId = `${eventPrefix}_03_success`;
    await sendWebhook(
      app,
      paymentIntentEvent(fixture, successEventId, 'succeeded', 1_786_560_300),
    ).expect(200);
    await waitForWebhookStatus(database, successEventId, 'PROCESSED');
    const staleEventId = `${eventPrefix}_03_stale`;
    const stale = await sendWebhook(
      app,
      paymentIntentEvent(
        fixture,
        staleEventId,
        'payment_failed',
        1_786_550_000,
      ),
    ).expect(200);

    expect(stale.body).toMatchObject({
      duplicate: false,
      queued: true,
    });
    await waitForWebhookStatus(database, staleEventId, 'IGNORED');
    await expect(readPaymentAndOrder(fixture)).resolves.toEqual({
      orderStatus: 'PAID',
      paymentStatus: 'SUCCEEDED',
    });
  });

  it('04 — timeout retry reuses the accepted provider operation', async () => {
    const order = await createOrder();
    const providerStart = fakeCheckout.uniqueOperationCount;
    const inputStart = fakeCheckout.inputs.length;
    fakeCheckout.failNextAfterProviderAcceptance();

    const timedOut = await request(app.getHttpServer())
      .post('/payments/checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ orderId: order.id })
      .expect(502);
    expect((timedOut.body as unknown as ErrorResponse).code).toBe(
      'PAYMENT_PROVIDER_ERROR',
    );

    const retry = await request(app.getHttpServer())
      .post('/payments/checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ orderId: order.id })
      .expect(201);
    const retryBody = retry.body as unknown as CheckoutSessionResponseDto;

    expect(fakeCheckout.uniqueOperationCount).toBe(providerStart + 1);
    expect(
      new Set(
        fakeCheckout.inputs
          .slice(inputStart)
          .map((input) => input.idempotencyKey),
      ),
    ).toEqual(new Set([`payment:create:stripe:${order.id}:1`]));
    const payment = await database.prisma.payment.findUniqueOrThrow({
      where: { id: retryBody.payment.id },
      include: { attempts: { orderBy: { createdAt: 'asc' } } },
    });
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.attempts.map((attempt) => attempt.status)).toEqual([
      PaymentAttemptStatus.FAILED,
      PaymentAttemptStatus.SUCCEEDED,
    ]);
  });

  it('05 — process restart before webhook handling recovers on retry', async () => {
    const fixture = await createCheckoutFixture();
    const eventId = `${eventPrefix}_05_restart`;
    const event = paymentIntentEvent(fixture, eventId, 'succeeded');
    const crashModule = await createTestingModule({
      processProviderEvent: jest
        .fn()
        .mockRejectedValue(new Error('Simulated process termination.')),
    });
    const crashedApp = configureApplication(
      crashModule.createNestApplication({ rawBody: true }),
    );

    try {
      await crashedApp.init();
      await sendWebhook(crashedApp, event).expect(500);
    } finally {
      await crashedApp.close();
    }

    await expect(
      database.prisma.webhookEvent.count({
        where: { providerEventId: eventId },
      }),
    ).resolves.toBe(0);
    await expect(readPaymentAndOrder(fixture)).resolves.toEqual({
      orderStatus: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
    });

    await sendWebhook(app, event).expect(200);
    await waitForWebhookStatus(database, eventId, 'PROCESSED');
    await expect(readPaymentAndOrder(fixture)).resolves.toEqual({
      orderStatus: 'PAID',
      paymentStatus: 'SUCCEEDED',
    });
  });

  it('06 — duplicate refund clicks reuse one local and provider refund', async () => {
    const fixture = await createPaidFixture('06_refund_duplicate');
    const providerStart = fakeRefund.uniqueOperationCount;
    const refundRequestId = randomUUID();
    const body = {
      amount: Math.max(1, Math.floor(fixture.amount / 2)),
      reason: 'Failure Lab duplicate refund click.',
      refundRequestId,
    };
    const firstResponse = await request(app.getHttpServer())
      .post(`/admin/payments/${fixture.paymentId}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    const replayResponse = await request(app.getHttpServer())
      .post(`/admin/payments/${fixture.paymentId}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    const first = firstResponse.body as unknown as CreateRefundResponseDto;
    const replay = replayResponse.body as unknown as CreateRefundResponseDto;

    expect(replay.reused).toBe(true);
    expect(replay.refund.id).toBe(first.refund.id);
    expect(replay.refund.providerRefundId).toBe(first.refund.providerRefundId);
    expect(fakeRefund.uniqueOperationCount).toBe(providerStart + 1);
    await expect(
      database.prisma.refund.count({
        where: { paymentId: fixture.paymentId, refundRequestId },
      }),
    ).resolves.toBe(1);
    await expect(
      database.prisma.auditLog.count({
        where: { action: 'REFUND_REQUESTED', targetId: first.refund.id },
      }),
    ).resolves.toBe(1);
  });

  it('07 — concurrent partial refunds cannot reserve above payment amount', async () => {
    const fixture = await createPaidFixture('07_refund_concurrent');
    const partialAmount = Math.max(1, Math.ceil((fixture.amount * 3) / 4));
    expect(partialAmount).toBeLessThan(fixture.amount);
    const providerStart = fakeRefund.uniqueOperationCount;
    const gate = fakeRefund.blockNextNewOperation();
    const firstRequest = request(app.getHttpServer())
      .post(`/admin/payments/${fixture.paymentId}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: partialAmount,
        reason: 'Failure Lab concurrent partial refund A.',
        refundRequestId: randomUUID(),
      })
      .then((response) => response);

    await gate.entered;
    const competing = await request(app.getHttpServer())
      .post(`/admin/payments/${fixture.paymentId}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: partialAmount,
        reason: 'Failure Lab concurrent partial refund B.',
        refundRequestId: randomUUID(),
      })
      .expect(409);
    gate.release();
    const first = await firstRequest;

    expect(first.status).toBe(201);
    expect((competing.body as unknown as ErrorResponse).code).toBe(
      'REFUND_AMOUNT_EXCEEDED',
    );
    expect(fakeRefund.uniqueOperationCount).toBe(providerStart + 1);
    const aggregate = await database.prisma.refund.aggregate({
      where: {
        paymentId: fixture.paymentId,
        status: {
          in: [DatabaseRefundStatus.PENDING, DatabaseRefundStatus.SUCCEEDED],
        },
      },
      _sum: { amount: true },
    });
    expect(aggregate._sum.amount).toBe(partialAmount);
    expect(aggregate._sum.amount).toBeLessThanOrEqual(fixture.amount);
  });

  it('08 — a mid-transaction database failure cannot split Payment and Order', async () => {
    const fixture = await createCheckoutFixture();
    const eventId = `${eventPrefix}_08_atomicity`;
    const event = paymentIntentEvent(fixture, eventId, 'succeeded');
    await database.prisma.$executeRawUnsafe(
      `ALTER TABLE "orders" ADD CONSTRAINT "${atomicityConstraint}" CHECK ("id" <> '${fixture.orderId}'::uuid OR "status" <> 'PAID') NOT VALID`,
    );

    try {
      await sendWebhook(app, event).expect(200);
      await waitForWebhookStatus(database, eventId, 'FAILED');
      await expect(readPaymentAndOrder(fixture)).resolves.toEqual({
        orderStatus: 'PENDING_PAYMENT',
        paymentStatus: 'PENDING',
      });
      await expect(
        database.prisma.webhookEvent.findUniqueOrThrow({
          where: {
            provider_providerEventId: {
              provider: 'STRIPE',
              providerEventId: eventId,
            },
          },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: 'FAILED' });
    } finally {
      await dropAtomicityConstraint();
    }

    const recoveryEventId = `${eventId}_recovery`;
    await sendWebhook(
      app,
      paymentIntentEvent(fixture, recoveryEventId, 'succeeded'),
    ).expect(200);
    await waitForWebhookStatus(database, recoveryEventId, 'PROCESSED');
    await expect(readPaymentAndOrder(fixture)).resolves.toEqual({
      orderStatus: 'PAID',
      paymentStatus: 'SUCCEEDED',
    });
  });

  it('09 — an invalid webhook signature changes no business state', async () => {
    const fixture = await createCheckoutFixture();
    const eventId = `${eventPrefix}_09_forged`;
    const forged = await sendWebhook(
      app,
      paymentIntentEvent(fixture, eventId, 'succeeded'),
      'whsec_failure_lab_wrong',
    ).expect(400);

    expect((forged.body as unknown as ErrorResponse).code).toBe(
      'WEBHOOK_SIGNATURE_INVALID',
    );
    await expect(
      database.prisma.webhookEvent.count({
        where: { providerEventId: eventId },
      }),
    ).resolves.toBe(0);
    await expect(readPaymentAndOrder(fixture)).resolves.toEqual({
      orderStatus: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
    });
  });

  it('10 — an ordinary USER receives 403 from the refund API', async () => {
    const fixture = await createPaidFixture('10_user_forbidden');
    const response = await request(app.getHttpServer())
      .post(`/admin/payments/${fixture.paymentId}/refunds`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        amount: 1,
        reason: 'A USER must not create refunds.',
        refundRequestId: randomUUID(),
      })
      .expect(403);

    expect((response.body as unknown as ErrorResponse).code).toBe(
      'AUTH_FORBIDDEN',
    );
    await expect(
      database.prisma.refund.count({
        where: { paymentId: fixture.paymentId },
      }),
    ).resolves.toBe(0);
  });

  afterAll(async () => {
    await webhookWorker?.close();
    if (database) {
      await dropAtomicityConstraint();
      await database.prisma.webhookEvent.deleteMany({
        where: { providerEventId: { startsWith: eventPrefix } },
      });
      const refunds = await database.prisma.refund.findMany({
        where: { payment: { orderId: { in: orderIds } } },
        select: { id: true },
      });
      if (refunds.length > 0) {
        await database.prisma.auditLog.deleteMany({
          where: { targetId: { in: refunds.map((refund) => refund.id) } },
        });
      }
      await database.prisma.refund.deleteMany({
        where: { payment: { orderId: { in: orderIds } } },
      });
      await database.prisma.payment.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await database.prisma.order.deleteMany({
        where: { id: { in: orderIds } },
      });
      await database.prisma.user.deleteMany({ where: { email: userEmail } });
    }
    await app?.close();
  });

  async function createTestingModule(
    webhookRepository?: Pick<WebhooksRepository, 'processProviderEvent'>,
  ): Promise<TestingModule> {
    let builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(fakeProvider);

    if (webhookRepository) {
      builder = builder
        .overrideProvider(WebhooksRepository)
        .useValue(webhookRepository);
    }

    return builder.compile();
  }

  function configureApplication(
    target: INestApplication<App>,
  ): INestApplication<App> {
    target.useGlobalFilters(new ApiExceptionFilter());
    target.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    return target;
  }

  async function createOrder(): Promise<OrderResponseDto> {
    const response = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ items: [{ productId, quantity: 1 }] })
      .expect(201);
    const order = response.body as unknown as OrderResponseDto;
    orderIds.push(order.id);
    return order;
  }

  async function createCheckoutFixture(): Promise<LabFixture> {
    const order = await createOrder();
    const response = await request(app.getHttpServer())
      .post('/payments/checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ orderId: order.id })
      .expect(201);
    const checkout = response.body as unknown as CheckoutSessionResponseDto;

    return {
      amount: order.totalAmount,
      currency: order.currency,
      orderId: order.id,
      paymentId: checkout.payment.id,
      providerPaymentId: providerPaymentId(checkout.payment.id),
    };
  }

  async function createPaidFixture(label: string): Promise<LabFixture> {
    const fixture = await createCheckoutFixture();
    const eventId = `${eventPrefix}_${label}_paid`;
    await sendWebhook(
      app,
      paymentIntentEvent(fixture, eventId, 'succeeded'),
    ).expect(200);
    await waitForWebhookStatus(database, eventId, 'PROCESSED');
    return fixture;
  }

  async function readPaymentAndOrder(fixture: LabFixture): Promise<{
    orderStatus: string;
    paymentStatus: string;
  }> {
    const [payment, order] = await Promise.all([
      database.prisma.payment.findUniqueOrThrow({
        where: { id: fixture.paymentId },
        select: { status: true },
      }),
      database.prisma.order.findUniqueOrThrow({
        where: { id: fixture.orderId },
        select: { status: true },
      }),
    ]);

    return {
      orderStatus: order.status,
      paymentStatus: payment.status,
    };
  }

  function sendWebhook(
    target: INestApplication<App>,
    event: Record<string, unknown>,
    signingSecret = webhookSecret,
  ) {
    const payload = JSON.stringify(event, null, 2);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: signingSecret,
    });

    return request(target.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);
  }

  async function dropAtomicityConstraint(): Promise<void> {
    await database.prisma.$executeRawUnsafe(
      `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "${atomicityConstraint}"`,
    );
  }
});

function paymentIntentEvent(
  fixture: LabFixture,
  eventId: string,
  outcome: 'payment_failed' | 'succeeded',
  created = 1_786_560_500,
): Record<string, unknown> {
  return {
    api_version: '2026-07-29.dahlia',
    created,
    data: {
      object: {
        amount: fixture.amount,
        currency: fixture.currency.toLowerCase(),
        id: fixture.providerPaymentId,
        metadata: {
          orderId: fixture.orderId,
          paymentId: fixture.paymentId,
        },
        object: 'payment_intent',
      },
    },
    id: eventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: null,
    type: `payment_intent.${outcome}`,
  };
}

function providerPaymentId(paymentId: string): string {
  return `pi_failure_lab_${paymentId.replaceAll('-', '')}`;
}
