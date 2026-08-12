import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RefundStatus } from '@payflow/database';
import {
  type CreatePaymentInput,
  type CreatePaymentResult,
  PAYMENT_PROVIDER,
  type PaymentProvider,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  type RefundPaymentInput,
  type RefundPaymentResult,
} from '@payflow/payment-core';
import { StripeProvider } from '@payflow/payment-stripe';
import request from 'supertest';
import { App } from 'supertest/types';
import Stripe from 'stripe';

import { AppModule } from './../src/app.module';
import {
  AdminAuditLogsResponseDto,
  AdminDashboardResponseDto,
  AdminOrderDetailDto,
  AdminOrdersResponseDto,
  AdminPaymentDetailDto,
  AdminPaymentsResponseDto,
  AdminRefundsResponseDto,
  AdminWebhooksResponseDto,
} from './../src/admin/dto/admin-response.dto';
import { AuthResponseDto } from './../src/auth/dto/auth-response.dto';
import { UserResponseDto } from './../src/auth/dto/user-response.dto';
import { DatabaseService } from './../src/database/database.service';
import { ApiExceptionFilter } from './../src/http/api-exception.filter';
import { ProductListResponseDto } from './../src/products/dto/product-list-response.dto';
import { ProductResponseDto } from './../src/products/dto/product-response.dto';
import { OrderResponseDto } from './../src/orders/dto/order-response.dto';
import { CheckoutSessionResponseDto } from './../src/payments/dto/payment-response.dto';
import { CreateRefundResponseDto } from './../src/refunds/dto/refund-response.dto';
import { WebhookResponseDto } from './../src/webhooks/dto/webhook-response.dto';

interface ErrorResponse {
  code: string;
}

class FakePaymentOperations {
  readonly inputs: CreatePaymentInput[] = [];
  private readonly sessions = new Map<string, CreatePaymentResult>();

  isConfigured(): boolean {
    return true;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.inputs.push(input);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const replay = this.sessions.get(input.idempotencyKey);
    if (replay) {
      return replay;
    }

    const result: CreatePaymentResult = {
      amount: input.amount,
      currency: input.currency,
      expiresAt: new Date(Date.now() + 86_400_000),
      providerCheckoutSessionId: `cs_test_${this.sessions.size + 1}`,
      providerPaymentId: null,
      providerRequestId: `req_test_${this.sessions.size + 1}`,
      redirectUrl: `https://checkout.stripe.test/c/payflow_${this.sessions.size + 1}`,
      status: ProviderPaymentStatus.PENDING,
    };
    this.sessions.set(input.idempotencyKey, result);
    return result;
  }

  get uniqueSessionCount(): number {
    return this.sessions.size;
  }
}

class FakeRefundOperations {
  readonly inputs: RefundPaymentInput[] = [];
  private blockedOperation:
    | {
        entered: Promise<void>;
        markEntered: () => void;
        release: () => void;
        released: Promise<void>;
      }
    | undefined;
  private readonly refunds = new Map<string, RefundPaymentResult>();
  private readonly statusQueue: ProviderRefundStatus[] = [];

  isConfigured(): boolean {
    return true;
  }

  enqueueStatus(status: ProviderRefundStatus): void {
    this.statusQueue.push(status);
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
    this.blockedOperation = { entered, markEntered, release, released };

    return { entered, release };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    this.inputs.push(input);

    const replay = this.refunds.get(input.idempotencyKey);
    if (replay) {
      return replay;
    }

    const status = this.statusQueue.shift() ?? ProviderRefundStatus.SUCCEEDED;
    const sequence = this.refunds.size + 1;
    const result: RefundPaymentResult = {
      amount: input.amount,
      currency: 'USD',
      failureCode: null,
      failureMessage: null,
      providerPaymentId: input.providerPaymentId,
      providerRefundId: `re_payflow_stage_5_${sequence}`,
      providerRequestId: `req_refund_stage_5_${sequence}`,
      status,
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

  get uniqueRefundCount(): number {
    return this.refunds.size;
  }
}

describe('PayFlow API acceptance through Stage 7 (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const userEmail = `stage-1-${Date.now()}@example.com`;
  const userPassword = 'Reliable-payments-2026!';
  const orderOwnerEmail = `stage-2-owner-${Date.now()}@example.com`;
  const otherUserEmail = `stage-2-other-${Date.now()}@example.com`;
  let stageTwoOrderId: string | undefined;
  let stageTwoProductId: string | undefined;
  let stageTwoOwnerToken: string | undefined;
  let stageTwoOtherToken: string | undefined;
  let stageThreeOrderId: string | undefined;
  let stageThreePaymentId: string | undefined;
  let stageThreeOrderAmount: number | undefined;
  let stageThreeOrderCurrency: string | undefined;
  let stageThreeRaceOrderId: string | undefined;
  let adminToken: string | undefined;
  let firstRefundId: string | undefined;
  let secondRefundId: string | undefined;
  const webhookEventPrefix = `evt_payflow_stage_5_${Date.now()}`;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;
  const fakeStripe = new FakePaymentOperations();
  const fakeStripeRefund = new FakeRefundOperations();
  const stripeVerifier = new StripeProvider({
    secretKey: 'sk_test_payflow_e2e_adapter_only',
    webhookSecret,
  });
  const fakeProvider: PaymentProvider = {
    createPayment: (input) => fakeStripe.createPayment(input),
    getPayment: () =>
      Promise.reject(new Error('Provider lookup is not used in this suite.')),
    isConfigured: () => true,
    name: 'STRIPE',
    refundPayment: (input) => fakeStripeRefund.refundPayment(input),
    verifyWebhook: (input) => stripeVerifier.verifyWebhook(input),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(fakeProvider)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
    database = app.get(DatabaseService);
  });

  it('exposes system and seeded product reads without authentication', async () => {
    await request(app.getHttpServer()).get('/').expect(200).expect({
      service: 'PayFlow API',
      stage: 7,
      health: '/health',
      docs: '/docs',
    });

    const list = await request(app.getHttpServer())
      .get('/products')
      .expect(200);
    const listBody = list.body as unknown as ProductListResponseDto;
    expect(listBody.count).toBe(4);
    expect(listBody.items).toHaveLength(4);
    const firstProduct = listBody.items[0];
    expect(firstProduct).toBeDefined();
    expect(firstProduct?.active).toBe(true);
    expect(firstProduct?.currency).toBe('USD');
    expect(Number.isInteger(firstProduct?.priceAmount)).toBe(true);

    const productId = firstProduct?.id;
    expect(productId).toBeDefined();
    const detail = await request(app.getHttpServer())
      .get(`/products/${productId}`)
      .expect(200);
    const detailBody = detail.body as unknown as ProductResponseDto;
    expect(detailBody.id).toBe(productId);

    const missingProduct = await request(app.getHttpServer())
      .get('/products/00000000-0000-4000-8000-000000000000')
      .expect(404);
    const missingProductBody = missingProduct.body as unknown as ErrorResponse;
    expect(missingProductBody.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('registers, logs in, and isolates USER from ADMIN', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `role-${userEmail}`,
        password: userPassword,
        role: 'ADMIN',
      })
      .expect(400);

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: userEmail.toUpperCase(), password: userPassword })
      .expect(201);
    const registrationBody = registration.body as unknown as AuthResponseDto;
    expect(registrationBody).toMatchObject({
      expiresIn: 900,
      user: { email: userEmail, role: 'USER' },
    });
    expect(registrationBody.user).not.toHaveProperty('password');
    expect(registrationBody.user).not.toHaveProperty('passwordHash');

    const duplicateRegistration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: userEmail, password: userPassword })
      .expect(409);
    const duplicateBody =
      duplicateRegistration.body as unknown as ErrorResponse;
    expect(duplicateBody.code).toBe('AUTH_EMAIL_EXISTS');

    const invalidLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: 'incorrect-password' })
      .expect(401);
    const invalidLoginBody = invalidLogin.body as unknown as ErrorResponse;
    expect(invalidLoginBody.code).toBe('AUTH_INVALID_CREDENTIALS');

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: userPassword })
      .expect(200);
    const loginBody = login.body as unknown as AuthResponseDto;
    const userToken = loginBody.accessToken;

    await request(app.getHttpServer()).get('/auth/me').expect(401);
    const currentUser = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const currentUserBody = currentUser.body as unknown as UserResponseDto;
    expect(currentUserBody).toMatchObject({ email: userEmail, role: 'USER' });
    expect(currentUserBody).not.toHaveProperty('passwordHash');

    const forbidden = await request(app.getHttpServer())
      .get('/admin/profile')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    const forbiddenBody = forbidden.body as unknown as ErrorResponse;
    expect(forbiddenBody.code).toBe('AUTH_FORBIDDEN');

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: process.env.PAYFLOW_ADMIN_EMAIL,
        password: process.env.PAYFLOW_ADMIN_PASSWORD,
      })
      .expect(200);
    const adminLoginBody = adminLogin.body as unknown as AuthResponseDto;
    adminToken = adminLoginBody.accessToken;

    const adminProfile = await request(app.getHttpServer())
      .get('/admin/profile')
      .set('Authorization', `Bearer ${adminLoginBody.accessToken}`)
      .expect(200);
    const adminProfileBody = adminProfile.body as unknown as UserResponseDto;
    expect(adminProfileBody).toMatchObject({
      email: process.env.PAYFLOW_ADMIN_EMAIL,
      role: 'ADMIN',
    });
  });

  it('creates server-priced snapshots, isolates ownership, and cancels only pending orders', async () => {
    const product = await database.prisma.product.create({
      data: {
        active: true,
        currency: 'USD',
        name: 'Stage 2 Price Authority',
        priceAmount: 1999,
        sku: `PF-S2-${Date.now()}`,
        stock: 5,
      },
    });
    stageTwoProductId = product.id;

    const ownerRegistration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: orderOwnerEmail, password: userPassword })
      .expect(201);
    const owner = ownerRegistration.body as unknown as AuthResponseDto;
    stageTwoOwnerToken = owner.accessToken;
    const otherRegistration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: otherUserEmail, password: userPassword })
      .expect(201);
    const other = otherRegistration.body as unknown as AuthResponseDto;
    stageTwoOtherToken = other.accessToken;

    const tampered = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        items: [{ productId: product.id, quantity: 2, unitPriceAmount: 1 }],
      })
      .expect(400);
    expect((tampered.body as unknown as ErrorResponse).code).toBe('HTTP_400');

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ items: [{ productId: product.id, quantity: 2 }] })
      .expect(201);
    const createdOrder = created.body as unknown as OrderResponseDto;
    stageTwoOrderId = createdOrder.id;
    expect(createdOrder).toMatchObject({
      currency: 'USD',
      status: 'PENDING_PAYMENT',
      subtotalAmount: 3998,
      totalAmount: 3998,
    });
    expect(createdOrder.items).toEqual([
      expect.objectContaining({
        lineTotalAmount: 3998,
        nameSnapshot: 'Stage 2 Price Authority',
        quantity: 2,
        unitPriceAmount: 1999,
      }),
    ]);

    await database.prisma.product.update({
      where: { id: product.id },
      data: { name: 'Changed After Order', priceAmount: 9999 },
    });

    const detail = await request(app.getHttpServer())
      .get(`/orders/${createdOrder.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const detailOrder = detail.body as unknown as OrderResponseDto;
    expect(detailOrder.items[0]).toMatchObject({
      nameSnapshot: 'Stage 2 Price Authority',
      unitPriceAmount: 1999,
    });

    const list = await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(list.body).toMatchObject({
      count: 1,
      items: [expect.objectContaining({ id: createdOrder.id })],
    });

    const hidden = await request(app.getHttpServer())
      .get(`/orders/${createdOrder.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
    expect((hidden.body as unknown as ErrorResponse).code).toBe(
      'ORDER_NOT_FOUND',
    );

    const cancelled = await request(app.getHttpServer())
      .post(`/orders/${createdOrder.id}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED' });

    const repeatedCancellation = await request(app.getHttpServer())
      .post(`/orders/${createdOrder.id}/cancel`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(409);
    expect((repeatedCancellation.body as unknown as ErrorResponse).code).toBe(
      'ORDER_TRANSITION_INVALID',
    );

    const checkoutForCancelledOrder = await request(app.getHttpServer())
      .post('/payments/checkout-session')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ orderId: createdOrder.id })
      .expect(409);
    expect(
      (checkoutForCancelledOrder.body as unknown as ErrorResponse).code,
    ).toBe('ORDER_NOT_PAYABLE');
    await expect(
      database.prisma.payment.count({ where: { orderId: createdOrder.id } }),
    ).resolves.toBe(0);
  });

  it('reuses one Stripe Checkout operation across concurrent duplicate clicks', async () => {
    const products = await request(app.getHttpServer())
      .get('/products')
      .expect(200);
    const product = (products.body as unknown as ProductListResponseDto)
      .items[0];
    expect(product).toBeDefined();

    expect(stageTwoOwnerToken).toBeDefined();
    expect(stageTwoOtherToken).toBeDefined();

    const orderCreation = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${stageTwoOwnerToken}`)
      .send({ items: [{ productId: product.id, quantity: 2 }] })
      .expect(201);
    const order = orderCreation.body as unknown as OrderResponseDto;
    stageThreeOrderId = order.id;

    const createCheckout = () =>
      request(app.getHttpServer())
        .post('/payments/checkout-session')
        .set('Authorization', `Bearer ${stageTwoOwnerToken}`)
        .send({ orderId: order.id })
        .expect(201);
    const [firstResult, secondResult] = await Promise.all([
      createCheckout(),
      createCheckout(),
    ]);
    const first = firstResult.body as unknown as CheckoutSessionResponseDto;
    const second = secondResult.body as unknown as CheckoutSessionResponseDto;
    stageThreePaymentId = first.payment.id;
    stageThreeOrderAmount = order.totalAmount;
    stageThreeOrderCurrency = order.currency;

    expect(first.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    expect(second.payment.id).toBe(first.payment.id);
    expect(second.payment.providerCheckoutSessionId).toBe(
      first.payment.providerCheckoutSessionId,
    );
    expect(first.payment).toMatchObject({
      amount: order.totalAmount,
      currency: order.currency,
      provider: 'STRIPE',
      status: 'PENDING',
    });
    expect(fakeStripe.uniqueSessionCount).toBe(1);
    expect(
      new Set(fakeStripe.inputs.map((input) => input.idempotencyKey)),
    ).toEqual(new Set([`payment:create:${order.id}:1`]));
    expect(fakeStripe.inputs[0]).toMatchObject({
      amount: order.totalAmount,
      currency: order.currency,
      lines: order.items.map((item) => ({
        name: item.nameSnapshot,
        quantity: item.quantity,
        sku: item.skuSnapshot,
        unitAmount: item.unitPriceAmount,
      })),
      orderId: order.id,
      paymentId: first.payment.id,
    });

    const thirdResult = await createCheckout();
    const third = thirdResult.body as unknown as CheckoutSessionResponseDto;
    expect(third).toMatchObject({
      checkoutUrl: first.checkoutUrl,
      payment: { id: first.payment.id, status: 'PENDING' },
      reused: true,
    });
    expect(fakeStripe.uniqueSessionCount).toBe(1);

    const localPayments = await database.prisma.payment.findMany({
      where: { orderId: order.id },
      include: { attempts: true },
    });
    expect(localPayments).toHaveLength(1);
    expect(localPayments[0]?.attempts.length).toBeGreaterThanOrEqual(1);

    const paymentRead = await request(app.getHttpServer())
      .get(`/payments/${first.payment.id}`)
      .set('Authorization', `Bearer ${stageTwoOwnerToken}`)
      .expect(200);
    expect(paymentRead.body).toMatchObject({
      id: first.payment.id,
      status: 'PENDING',
    });

    const hiddenPayment = await request(app.getHttpServer())
      .get(`/payments/${first.payment.id}`)
      .set('Authorization', `Bearer ${stageTwoOtherToken}`)
      .expect(404);
    expect((hiddenPayment.body as unknown as ErrorResponse).code).toBe(
      'PAYMENT_NOT_FOUND',
    );

    const orderAfterCheckout = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${stageTwoOwnerToken}`)
      .expect(200);
    expect(orderAfterCheckout.body).toMatchObject({
      status: 'PENDING_PAYMENT',
      payments: [
        expect.objectContaining({ id: first.payment.id, status: 'PENDING' }),
      ],
    });
  });

  it('rejects a forged Stripe signature without persisting or changing state', async () => {
    expect(stageThreeOrderId).toBeDefined();
    expect(stageThreePaymentId).toBeDefined();
    expect(stageThreeOrderAmount).toBeDefined();
    expect(stageThreeOrderCurrency).toBeDefined();

    const eventId = `${webhookEventPrefix}_forged`;
    const event = paymentIntentEvent(
      eventId,
      'payment_intent.succeeded',
      stageThreePaymentId as string,
      stageThreeOrderId as string,
      stageThreeOrderAmount as number,
      stageThreeOrderCurrency as string,
    );
    const response = await sendWebhook(event, 'whsec_wrong_secret').expect(400);

    expect((response.body as unknown as ErrorResponse).code).toBe(
      'WEBHOOK_SIGNATURE_INVALID',
    );
    await expect(
      database.prisma.webhookEvent.count({
        where: { providerEventId: eventId },
      }),
    ).resolves.toBe(0);
    await expect(
      database.prisma.payment.findUniqueOrThrow({
        where: { id: stageThreePaymentId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PENDING' });
  });

  it('atomically applies one legitimate event across five concurrent deliveries', async () => {
    expect(stageThreeOrderId).toBeDefined();
    expect(stageThreePaymentId).toBeDefined();
    expect(stageThreeOrderAmount).toBeDefined();
    expect(stageThreeOrderCurrency).toBeDefined();

    const eventId = `${webhookEventPrefix}_succeeded`;
    const event = paymentIntentEvent(
      eventId,
      'payment_intent.succeeded',
      stageThreePaymentId as string,
      stageThreeOrderId as string,
      stageThreeOrderAmount as number,
      stageThreeOrderCurrency as string,
    );
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => sendWebhook(event).expect(200)),
    );
    const bodies = responses.map(
      (response) => response.body as unknown as WebhookResponseDto,
    );

    expect(bodies.filter((body) => !body.duplicate)).toHaveLength(1);
    expect(bodies.filter((body) => body.duplicate)).toHaveLength(4);
    expect(bodies.every((body) => body.status === 'PROCESSED')).toBe(true);

    const persistedEvents = await database.prisma.webhookEvent.findMany({
      where: { providerEventId: eventId },
    });
    expect(persistedEvents).toHaveLength(1);
    expect(persistedEvents[0]).toMatchObject({
      deliveryCount: 5,
      eventType: 'payment_intent.succeeded',
      provider: 'STRIPE',
      status: 'PROCESSED',
    });
    expect(persistedEvents[0]?.processedAt).not.toBeNull();

    await expect(
      database.prisma.payment.findUniqueOrThrow({
        where: { id: stageThreePaymentId },
        select: { providerPaymentId: true, status: true },
      }),
    ).resolves.toEqual({
      providerPaymentId: `pi_${webhookEventPrefix}`,
      status: 'SUCCEEDED',
    });
    await expect(
      database.prisma.order.findUniqueOrThrow({
        where: { id: stageThreeOrderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PAID' });
  });

  it('persists a signed amount mismatch but rejects every business mutation', async () => {
    expect(stageThreeOrderId).toBeDefined();
    expect(stageThreePaymentId).toBeDefined();
    expect(stageThreeOrderAmount).toBeDefined();
    expect(stageThreeOrderCurrency).toBeDefined();

    const eventId = `${webhookEventPrefix}_amount_mismatch`;
    const event = paymentIntentEvent(
      eventId,
      'payment_intent.succeeded',
      stageThreePaymentId as string,
      stageThreeOrderId as string,
      (stageThreeOrderAmount as number) + 1,
      stageThreeOrderCurrency as string,
    );
    const response = await sendWebhook(event).expect(400);

    expect((response.body as unknown as ErrorResponse).code).toBe(
      'WEBHOOK_EVENT_REJECTED',
    );
    await expect(
      database.prisma.webhookEvent.findUniqueOrThrow({
        where: { providerEventId: eventId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'FAILED' });
    await expect(
      database.prisma.payment.findUniqueOrThrow({
        where: { id: stageThreePaymentId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'SUCCEEDED' });
    await expect(
      database.prisma.order.findUniqueOrThrow({
        where: { id: stageThreeOrderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PAID' });
  });

  it('persists but ignores an older failure and an unknown signed event', async () => {
    expect(stageThreeOrderId).toBeDefined();
    expect(stageThreePaymentId).toBeDefined();
    expect(stageThreeOrderAmount).toBeDefined();
    expect(stageThreeOrderCurrency).toBeDefined();

    const staleEvent = paymentIntentEvent(
      `${webhookEventPrefix}_stale_failure`,
      'payment_intent.payment_failed',
      stageThreePaymentId as string,
      stageThreeOrderId as string,
      stageThreeOrderAmount as number,
      stageThreeOrderCurrency as string,
      1_786_559_000,
    );
    const staleResponse = await sendWebhook(staleEvent).expect(200);
    expect(staleResponse.body).toMatchObject({
      duplicate: false,
      received: true,
      status: 'IGNORED',
    });

    const unknownResponse = await sendWebhook({
      api_version: '2026-07-29.dahlia',
      created: 1_786_560_100,
      data: { object: { id: 'cus_stage_4', object: 'customer' } },
      id: `${webhookEventPrefix}_unknown`,
      livemode: false,
      object: 'event',
      pending_webhooks: 1,
      request: null,
      type: 'customer.created',
    }).expect(200);
    expect(unknownResponse.body).toMatchObject({
      duplicate: false,
      status: 'IGNORED',
    });

    await expect(
      database.prisma.payment.findUniqueOrThrow({
        where: { id: stageThreePaymentId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'SUCCEEDED' });
    await expect(
      database.prisma.order.findUniqueOrThrow({
        where: { id: stageThreeOrderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PAID' });
  });

  it('enforces ADMIN refunds, reuses one request, and finalizes pending refunds by webhook', async () => {
    expect(adminToken).toBeDefined();
    expect(stageTwoOwnerToken).toBeDefined();
    expect(stageThreeOrderId).toBeDefined();
    expect(stageThreePaymentId).toBeDefined();
    expect(stageThreeOrderAmount).toBeDefined();
    expect(stageThreeOrderCurrency).toBe('USD');

    await request(app.getHttpServer())
      .get('/admin/orders')
      .set('Authorization', `Bearer ${stageTwoOwnerToken}`)
      .expect(403)
      .expect((response) => {
        expect((response.body as unknown as ErrorResponse).code).toBe(
          'AUTH_FORBIDDEN',
        );
      });

    await request(app.getHttpServer())
      .post(`/admin/payments/${stageThreePaymentId}/refunds`)
      .set('Authorization', `Bearer ${stageTwoOwnerToken}`)
      .send({
        amount: 1,
        reason: 'A USER must never create an administrator refund.',
        refundRequestId: randomUUID(),
      })
      .expect(403)
      .expect((response) => {
        expect((response.body as unknown as ErrorResponse).code).toBe(
          'AUTH_FORBIDDEN',
        );
      });

    const paymentAmount = stageThreeOrderAmount as number;
    expect(paymentAmount).toBeGreaterThan(1);
    const partialAmount = Math.max(1, Math.floor(paymentAmount / 3));
    const refundRequestId = randomUUID();
    const reason = 'Customer returned one item in the sandbox.';
    const requestBody = { amount: partialAmount, reason, refundRequestId };
    fakeStripeRefund.enqueueStatus(ProviderRefundStatus.PENDING);

    const firstResponse = await request(app.getHttpServer())
      .post(`/admin/payments/${stageThreePaymentId}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(requestBody)
      .expect(201);
    const first = firstResponse.body as unknown as CreateRefundResponseDto;
    firstRefundId = first.refund.id;
    expect(first).toMatchObject({
      refund: {
        amount: partialAmount,
        paymentId: stageThreePaymentId,
        reason,
        refundRequestId,
        status: 'PENDING',
      },
      reused: false,
    });
    expect(first.refund.providerRefundId).toMatch(/^re_payflow_stage_5_/);

    const duplicateResponse = await request(app.getHttpServer())
      .post(`/admin/payments/${stageThreePaymentId}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(requestBody)
      .expect(201);
    const duplicate =
      duplicateResponse.body as unknown as CreateRefundResponseDto;
    expect(duplicate).toMatchObject({
      refund: { id: first.refund.id, status: 'PENDING' },
      reused: true,
    });
    expect(duplicate.refund.providerRefundId).toBe(
      first.refund.providerRefundId,
    );
    expect(fakeStripeRefund.uniqueRefundCount).toBe(1);
    expect(
      new Set(fakeStripeRefund.inputs.map((input) => input.idempotencyKey)),
    ).toEqual(
      new Set([
        `refund:create:${stageThreePaymentId as string}:${refundRequestId}`,
      ]),
    );

    const eventId = `${webhookEventPrefix}_refund_updated`;
    const event = refundEvent({
      amount: partialAmount,
      currency: stageThreeOrderCurrency as string,
      eventId,
      orderId: stageThreeOrderId as string,
      paymentId: stageThreePaymentId as string,
      providerPaymentId: `pi_${webhookEventPrefix}`,
      providerRefundId: first.refund.providerRefundId as string,
      refundId: first.refund.id,
      status: 'succeeded',
    });
    const webhook = await sendWebhook(event).expect(200);
    expect(webhook.body).toMatchObject({
      duplicate: false,
      status: 'PROCESSED',
    });
    const duplicateWebhook = await sendWebhook(event).expect(200);
    expect(duplicateWebhook.body).toMatchObject({
      duplicate: true,
      status: 'PROCESSED',
    });

    const terminalReplayResponse = await request(app.getHttpServer())
      .post(`/admin/payments/${stageThreePaymentId}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(requestBody)
      .expect(201);
    const terminalReplay =
      terminalReplayResponse.body as unknown as CreateRefundResponseDto;
    expect(terminalReplay).toMatchObject({
      refund: { id: first.refund.id, status: 'SUCCEEDED' },
      reused: true,
    });
    expect(fakeStripeRefund.inputs).toHaveLength(2);

    await expect(
      database.prisma.payment.findUniqueOrThrow({
        where: { id: stageThreePaymentId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PARTIALLY_REFUNDED' });
    await expect(
      database.prisma.order.findUniqueOrThrow({
        where: { id: stageThreeOrderId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PARTIALLY_REFUNDED' });

    const customerOrder = await request(app.getHttpServer())
      .get(`/orders/${stageThreeOrderId}`)
      .set('Authorization', `Bearer ${stageTwoOwnerToken}`)
      .expect(200);
    expect(customerOrder.body).toMatchObject({
      payments: [
        expect.objectContaining({
          id: stageThreePaymentId,
          refunds: [
            expect.objectContaining({
              amount: partialAmount,
              id: first.refund.id,
              status: 'SUCCEEDED',
            }),
          ],
        }),
      ],
      status: 'PARTIALLY_REFUNDED',
    });
  });

  it('serializes concurrent refund reservations and exposes paginated admin operations', async () => {
    expect(adminToken).toBeDefined();
    expect(stageThreeOrderId).toBeDefined();
    expect(stageThreePaymentId).toBeDefined();
    expect(stageThreeOrderAmount).toBeDefined();
    expect(firstRefundId).toBeDefined();

    const firstRefund = await database.prisma.refund.findUniqueOrThrow({
      where: { id: firstRefundId },
    });
    const remainingAmount =
      (stageThreeOrderAmount as number) - firstRefund.amount;
    const fullRequestId = randomUUID();
    const competingRequestId = randomUUID();
    const gate = fakeStripeRefund.blockNextNewOperation();
    const fullRequest = request(app.getHttpServer())
      .post(`/admin/payments/${stageThreePaymentId}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reason: 'Refund the full remaining sandbox balance.',
        refundRequestId: fullRequestId,
      })
      .then((response) => response);

    await gate.entered;
    const competing = await request(app.getHttpServer())
      .post(`/admin/payments/${stageThreePaymentId}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: remainingAmount,
        reason: 'Concurrent partial refund must respect the reserved amount.',
        refundRequestId: competingRequestId,
      })
      .expect(409);
    gate.release();
    const fullResponse = await fullRequest;

    expect((competing.body as unknown as ErrorResponse).code).toBe(
      'REFUND_AMOUNT_EXCEEDED',
    );
    expect(fullResponse.status).toBe(201);
    const full = fullResponse.body as unknown as CreateRefundResponseDto;
    secondRefundId = full.refund.id;
    expect(full).toMatchObject({
      refund: {
        amount: remainingAmount,
        refundRequestId: fullRequestId,
        status: 'SUCCEEDED',
      },
      reused: false,
    });
    expect(fakeStripeRefund.uniqueRefundCount).toBe(2);

    const replay = await request(app.getHttpServer())
      .post(`/admin/payments/${stageThreePaymentId}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reason: 'Refund the full remaining sandbox balance.',
        refundRequestId: fullRequestId,
      })
      .expect(201);
    expect(replay.body).toMatchObject({
      refund: { id: full.refund.id, status: 'SUCCEEDED' },
      reused: true,
    });
    expect(fakeStripeRefund.uniqueRefundCount).toBe(2);

    const totals = await database.prisma.refund.aggregate({
      where: {
        paymentId: stageThreePaymentId,
        status: RefundStatus.SUCCEEDED,
      },
      _sum: { amount: true },
    });
    expect(totals._sum.amount).toBe(stageThreeOrderAmount);
    await expect(
      database.prisma.payment.findUniqueOrThrow({
        where: { id: stageThreePaymentId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'REFUNDED' });
    const persistedOrder = await database.prisma.order.findUniqueOrThrow({
      where: { id: stageThreeOrderId },
      select: { orderNo: true, status: true },
    });
    expect(persistedOrder.status).toBe('REFUNDED');

    const dashboard = await request(app.getHttpServer())
      .get('/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const dashboardBody =
      dashboard.body as unknown as AdminDashboardResponseDto;
    expect(Number.isInteger(dashboardBody.failedPaymentCount)).toBe(true);
    expect(Number.isInteger(dashboardBody.failedWebhookCount)).toBe(true);
    expect(Number.isInteger(dashboardBody.orderCount)).toBe(true);
    expect(Number.isInteger(dashboardBody.successfulPaymentCount)).toBe(true);
    expect(
      dashboardBody.refundTotals.some((total) => total.currency === 'USD'),
    ).toBe(true);

    const orders = await request(app.getHttpServer())
      .get('/admin/orders')
      .query({ page: 1, pageSize: 1, query: persistedOrder.orderNo })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const ordersBody = orders.body as unknown as AdminOrdersResponseDto;
    expect(ordersBody).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
    expect(ordersBody.items.map((item) => item.id)).toEqual([
      stageThreeOrderId,
    ]);

    const orderDetail = await request(app.getHttpServer())
      .get(`/admin/orders/${stageThreeOrderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const orderDetailBody = orderDetail.body as unknown as AdminOrderDetailDto;
    expect(orderDetailBody.id).toBe(stageThreeOrderId);
    expect(orderDetailBody.status).toBe('REFUNDED');
    expect(orderDetailBody.payments).toHaveLength(1);
    expect(orderDetailBody.payments[0]).toMatchObject({
      id: stageThreePaymentId,
      status: 'REFUNDED',
    });
    expect(
      new Set(orderDetailBody.payments[0]?.refunds.map((refund) => refund.id)),
    ).toEqual(new Set([firstRefundId, secondRefundId]));

    const payments = await request(app.getHttpServer())
      .get('/admin/payments')
      .query({ page: 1, pageSize: 5, provider: 'STRIPE', status: 'REFUNDED' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const paymentsBody = payments.body as unknown as AdminPaymentsResponseDto;
    const listedPayment = paymentsBody.items.find(
      (payment) => payment.id === stageThreePaymentId,
    );
    expect(listedPayment).toMatchObject({
      refundedAmount: stageThreeOrderAmount,
      reservedRefundAmount: stageThreeOrderAmount,
    });

    const paymentDetail = await request(app.getHttpServer())
      .get(`/admin/payments/${stageThreePaymentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const paymentDetailBody =
      paymentDetail.body as unknown as AdminPaymentDetailDto;
    expect(paymentDetailBody).toMatchObject({
      id: stageThreePaymentId,
      provider: 'STRIPE',
      providerPaymentId: `pi_${webhookEventPrefix}`,
      status: 'REFUNDED',
    });
    expect(Number.isInteger(paymentDetailBody.providerAttemptCount)).toBe(true);

    const refunds = await request(app.getHttpServer())
      .get('/admin/refunds')
      .query({ page: 1, pageSize: 1, status: 'SUCCEEDED' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const refundsBody = refunds.body as unknown as AdminRefundsResponseDto;
    expect(refundsBody).toMatchObject({
      page: 1,
      pageSize: 1,
    });
    expect(refundsBody.items).toHaveLength(1);
    expect(refundsBody.items[0]?.status).toBe('SUCCEEDED');
    expect(refundsBody.total).toBeGreaterThanOrEqual(2);
    expect(refundsBody.totalPages).toBeGreaterThanOrEqual(2);

    const webhooks = await request(app.getHttpServer())
      .get('/admin/webhooks')
      .query({ eventType: 'refund.updated', page: 1, pageSize: 10 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const webhooksBody = webhooks.body as unknown as AdminWebhooksResponseDto;
    expect(webhooksBody.total).toBe(1);
    expect(webhooksBody.items).toEqual([
      expect.objectContaining({
        deliveryCount: 2,
        eventType: 'refund.updated',
        status: 'PROCESSED',
      }),
    ]);

    const auditLogs = await request(app.getHttpServer())
      .get('/admin/audit-logs')
      .query({ action: 'REFUND_REQUESTED', page: 1, pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const auditLogsBody =
      auditLogs.body as unknown as AdminAuditLogsResponseDto;
    const requestedAudit = auditLogsBody.items.find(
      (audit) => audit.targetId === firstRefundId,
    );
    expect(requestedAudit).toMatchObject({
      action: 'REFUND_REQUESTED',
      actorEmail: process.env.PAYFLOW_ADMIN_EMAIL,
      actorType: 'ADMIN',
      targetType: 'REFUND',
    });
    expect(requestedAudit?.metadata).toMatchObject({
      amount: firstRefund.amount,
      paymentId: stageThreePaymentId,
      reason: 'Customer returned one item in the sandbox.',
    });
  });

  it('serializes payment reservation against order cancellation', async () => {
    const products = await request(app.getHttpServer())
      .get('/products')
      .expect(200);
    const product = (products.body as unknown as ProductListResponseDto)
      .items[0];
    expect(product).toBeDefined();
    expect(stageTwoOwnerToken).toBeDefined();

    const orderCreation = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${stageTwoOwnerToken}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] })
      .expect(201);
    const order = orderCreation.body as unknown as OrderResponseDto;
    stageThreeRaceOrderId = order.id;

    const [checkout, cancellation] = await Promise.all([
      request(app.getHttpServer())
        .post('/payments/checkout-session')
        .set('Authorization', `Bearer ${stageTwoOwnerToken}`)
        .send({ orderId: order.id }),
      request(app.getHttpServer())
        .post(`/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${stageTwoOwnerToken}`),
    ]);

    expect(
      [checkout.status, cancellation.status].filter((code) => code === 409),
    ).toHaveLength(1);
    expect([200, 201]).toContain(
      checkout.status === 409 ? cancellation.status : checkout.status,
    );

    const persisted = await database.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
    if (persisted.status === 'CANCELLED') {
      expect(checkout.status).toBe(409);
      expect(persisted.payments).toHaveLength(0);
    } else {
      expect(persisted.status).toBe('PENDING_PAYMENT');
      expect(cancellation.status).toBe(409);
      expect(persisted.payments).toHaveLength(1);
    }
  });

  afterAll(async () => {
    if (database) {
      await database.prisma.webhookEvent.deleteMany({
        where: { providerEventId: { startsWith: webhookEventPrefix } },
      });
      const refundIds = [firstRefundId, secondRefundId].filter(
        (id): id is string => Boolean(id),
      );
      if (refundIds.length > 0) {
        await database.prisma.auditLog.deleteMany({
          where: { targetId: { in: refundIds } },
        });
      }
      if (stageThreeOrderId) {
        await database.prisma.refund.deleteMany({
          where: { payment: { orderId: stageThreeOrderId } },
        });
        await database.prisma.payment.deleteMany({
          where: { orderId: stageThreeOrderId },
        });
        await database.prisma.order.deleteMany({
          where: { id: stageThreeOrderId },
        });
      }
      if (stageThreeRaceOrderId) {
        await database.prisma.payment.deleteMany({
          where: { orderId: stageThreeRaceOrderId },
        });
        await database.prisma.order.deleteMany({
          where: { id: stageThreeRaceOrderId },
        });
      }
      if (stageTwoOrderId) {
        await database.prisma.order.deleteMany({
          where: { id: stageTwoOrderId },
        });
      }
      if (stageTwoProductId) {
        await database.prisma.product.deleteMany({
          where: { id: stageTwoProductId },
        });
      }
      await database.prisma.user.deleteMany({
        where: {
          email: {
            in: [
              userEmail,
              `role-${userEmail}`,
              orderOwnerEmail,
              otherUserEmail,
            ],
          },
        },
      });
    }
    await app?.close();
  });

  function sendWebhook(
    event: Record<string, unknown>,
    signingSecret = webhookSecret,
  ) {
    const payload = JSON.stringify(event, null, 2);
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: signingSecret,
    });

    return request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload);
  }
});

function paymentIntentEvent(
  eventId: string,
  type: 'payment_intent.payment_failed' | 'payment_intent.succeeded',
  paymentId: string,
  orderId: string,
  amount: number,
  currency: string,
  created = 1_786_560_000,
): Record<string, unknown> {
  return {
    api_version: '2026-07-29.dahlia',
    created,
    data: {
      object: {
        amount,
        currency: currency.toLowerCase(),
        id: `pi_${eventId.replace(
          /_(amount_mismatch|forged|succeeded|stale_failure)$/,
          '',
        )}`,
        metadata: { orderId, paymentId },
        object: 'payment_intent',
      },
    },
    id: eventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: null,
    type,
  };
}

function refundEvent(input: {
  amount: number;
  currency: string;
  eventId: string;
  orderId: string;
  paymentId: string;
  providerPaymentId: string;
  providerRefundId: string;
  refundId: string;
  status: 'failed' | 'pending' | 'succeeded';
}): Record<string, unknown> {
  return {
    api_version: '2026-07-29.dahlia',
    created: 1_786_560_200,
    data: {
      object: {
        amount: input.amount,
        currency: input.currency.toLowerCase(),
        failure_reason:
          input.status === 'failed' ? 'expired_or_canceled_card' : null,
        id: input.providerRefundId,
        metadata: {
          orderId: input.orderId,
          paymentId: input.paymentId,
          refundId: input.refundId,
        },
        object: 'refund',
        payment_intent: input.providerPaymentId,
        status: input.status,
      },
    },
    id: input.eventId,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: { id: `req_${input.eventId}`, idempotency_key: null },
    type: 'refund.updated',
  };
}
