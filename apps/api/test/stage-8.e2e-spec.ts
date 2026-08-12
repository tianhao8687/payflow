import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PAYMENT_PROVIDER,
  PAYMENT_PROVIDER_REGISTRY,
  type PaymentProvider,
  PaymentProviderError,
  PaymentProviderRegistry,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  type ProviderWebhookAction,
  type VerifyWebhookInput,
} from '@payflow/payment-core';
import { PayPalProvider } from '@payflow/payment-paypal';
import type { WebhookWorker } from '@payflow/payment-queue';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import type { AuthResponseDto } from '../src/auth/dto/auth-response.dto';
import { DatabaseService } from '../src/database/database.service';
import { ApiExceptionFilter } from '../src/http/api-exception.filter';
import type { OrderResponseDto } from '../src/orders/dto/order-response.dto';
import type { CheckoutSessionResponseDto } from '../src/payments/dto/payment-response.dto';
import type { ProductListResponseDto } from '../src/products/dto/product-list-response.dto';
import type { AdminWebhookQueueResponseDto } from '../src/admin/dto/admin-response.dto';
import { PAYPAL_PAYMENT_PROVIDER } from '../src/providers/payment-provider.module';
import {
  startTestWebhookWorker,
  waitForWebhookStatus,
} from './webhook-worker-harness';

class StageEightProvider implements PaymentProvider {
  private readonly sessions = new Map<
    string,
    { amount: number; currency: string; orderId: string; paymentId: string }
  >();
  private captureCalls = 0;

  constructor(readonly name: 'PAYPAL' | 'STRIPE') {}

  isConfigured(): boolean {
    return true;
  }

  async createPayment(input: Parameters<PaymentProvider['createPayment']>[0]) {
    await Promise.resolve();
    const sessionId = `${this.name.toLowerCase()}-session-${this.sessions.size + 1}`;
    this.sessions.set(sessionId, {
      amount: input.amount,
      currency: input.currency,
      orderId: input.orderId,
      paymentId: input.paymentId,
    });
    return {
      amount: input.amount,
      currency: input.currency,
      expiresAt: new Date(Date.now() + 21_600_000),
      providerCheckoutSessionId: sessionId,
      providerPaymentId: null,
      providerRequestId: `${this.name.toLowerCase()}-create-request`,
      redirectUrl:
        this.name === 'PAYPAL'
          ? `https://www.sandbox.paypal.com/checkoutnow?token=${sessionId}`
          : `https://checkout.stripe.test/c/${sessionId}`,
      status: ProviderPaymentStatus.PENDING,
    };
  }

  getPayment(): ReturnType<PaymentProvider['getPayment']> {
    return Promise.reject(new Error('Not used by the Stage 8 acceptance.'));
  }

  async capturePayment(
    input: Parameters<NonNullable<PaymentProvider['capturePayment']>>[0],
  ) {
    await Promise.resolve();
    this.captureCalls += 1;
    if (this.name !== 'PAYPAL') {
      throw new Error('Only the PayPal fixture uses server-side capture.');
    }
    if (this.captureCalls === 1) {
      throw new PaymentProviderError(
        'PAYPAL',
        'CAPTURE_PAYMENT',
        'PAYPAL_NETWORK_ERROR',
        'Simulated transient PayPal timeout.',
        null,
        true,
        true,
      );
    }
    const session = this.sessions.get(input.providerPaymentId);
    if (!session) {
      throw new Error('Unknown PayPal sandbox order.');
    }
    return {
      amount: session.amount,
      currency: session.currency,
      providerPaymentId: `paypal-capture-${session.paymentId}`,
      providerRequestId: 'paypal-capture-request',
      refundedAmount: 0,
      status: ProviderPaymentStatus.SUCCEEDED,
    };
  }

  async refundPayment(input: Parameters<PaymentProvider['refundPayment']>[0]) {
    await Promise.resolve();
    return {
      amount: input.amount,
      currency: input.currency,
      failureCode: null,
      failureMessage: null,
      providerPaymentId: input.providerPaymentId,
      providerRefundId: `${this.name.toLowerCase()}-refund-${input.refundId}`,
      providerRequestId: `${this.name.toLowerCase()}-refund-request`,
      status: ProviderRefundStatus.SUCCEEDED,
    };
  }

  async verifyWebhook(input: VerifyWebhookInput) {
    await Promise.resolve();
    const payload = JSON.parse(Buffer.from(input.rawBody).toString('utf8')) as {
      action: ProviderWebhookAction;
      eventType: string;
      providerEventId: string;
    };
    return {
      action: payload.action,
      eventType: payload.eventType,
      occurredAt: new Date(),
      payload,
      provider: this.name,
      providerEventId: payload.providerEventId,
    };
  }

  get captureAttemptCount(): number {
    return this.captureCalls;
  }
}

interface StoredPayPalOrder {
  currency: string;
  orderId: string;
  paymentId: string;
  providerOrderId: string;
  value: string;
}

class PayPalSandboxFixture {
  private readonly orders = new Map<string, StoredPayPalOrder>();
  private captures = 0;

  readonly fetch: typeof fetch = async (input, init) => {
    await Promise.resolve();
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith('/v1/oauth2/token')) {
      return this.response({ access_token: 'stage-8-token', expires_in: 3600 });
    }

    if (url.endsWith('/v2/checkout/orders')) {
      if (typeof init?.body !== 'string') {
        return this.response({ name: 'INVALID_REQUEST' }, 400);
      }
      const body = JSON.parse(init.body) as {
        purchase_units: Array<{
          amount: { currency_code: string; value: string };
          custom_id: string;
          invoice_id: string;
          reference_id: string;
        }>;
      };
      const unit = body.purchase_units[0];
      if (!unit) {
        return this.response({ name: 'INVALID_REQUEST' }, 400);
      }
      const providerOrderId = `PAYPAL-ORDER-${this.orders.size + 1}`;
      this.orders.set(providerOrderId, {
        currency: unit.amount.currency_code,
        orderId: unit.invoice_id,
        paymentId: unit.custom_id,
        providerOrderId,
        value: unit.amount.value,
      });
      return this.response({
        id: providerOrderId,
        links: [
          {
            href: `https://www.sandbox.paypal.com/checkoutnow?token=${providerOrderId}`,
            rel: 'payer-action',
          },
        ],
        purchase_units: body.purchase_units,
        status: 'CREATED',
      });
    }

    if (url.endsWith('/v1/notifications/verify-webhook-signature')) {
      return this.response({ verification_status: 'SUCCESS' });
    }

    const captureMatch = /\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(url);
    if (captureMatch) {
      this.captures += 1;
      if (this.captures === 1) {
        throw new Error('Simulated transient PayPal Sandbox timeout.');
      }
      const providerOrderId = decodeURIComponent(captureMatch[1]);
      const order = this.orders.get(providerOrderId);
      if (!order) {
        return this.response({ name: 'RESOURCE_NOT_FOUND' }, 404);
      }
      return this.response({
        id: order.providerOrderId,
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  amount: {
                    currency_code: order.currency,
                    value: order.value,
                  },
                  id: `paypal-capture-${order.paymentId}`,
                  status: 'COMPLETED',
                },
              ],
            },
          },
        ],
        status: 'COMPLETED',
      });
    }

    return this.response({ name: 'UNSUPPORTED_TEST_ROUTE' }, 500);
  };

  get captureAttemptCount(): number {
    return this.captures;
  }

  private response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json',
        'PayPal-Debug-Id': `stage-8-debug-${this.captures}`,
      },
      status,
    });
  }
}

describe('PayFlow Stage 8 PayPal and BullMQ acceptance (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let webhookWorker: WebhookWorker;
  let userToken: string;
  let adminToken: string;
  let productId: string;
  const stripe = new StageEightProvider('STRIPE');
  const paypalSandbox = new PayPalSandboxFixture();
  const paypal = new PayPalProvider({
    clientId: 'stage-8-client-id',
    clientSecret: 'stage-8-client-secret',
    fetch: paypalSandbox.fetch,
    webhookId: 'stage-8-webhook-id',
  });
  const email = `stage-8-${Date.now()}@example.com`;
  const orderIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(stripe)
      .overrideProvider(PAYPAL_PAYMENT_PROVIDER)
      .useValue(paypal)
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
    webhookWorker = startTestWebhookWorker(
      database,
      app.get<PaymentProviderRegistry>(PAYMENT_PROVIDER_REGISTRY),
    );
    await webhookWorker.waitUntilReady();

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Stage-8-sandbox-user-2026!' })
      .expect(201);
    userToken = (registration.body as AuthResponseDto).accessToken;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: process.env.PAYFLOW_ADMIN_EMAIL,
        password: process.env.PAYFLOW_ADMIN_PASSWORD,
      })
      .expect(200);
    adminToken = (login.body as AuthResponseDto).accessToken;
    const products = await request(app.getHttpServer())
      .get('/products')
      .expect(200);
    const product = (products.body as ProductListResponseDto).items[0];
    if (!product) {
      throw new Error(
        'Stage 8 acceptance requires the committed product seed.',
      );
    }
    productId = product.id;
  });

  it('completes Stripe and PayPal test payments through one business API', async () => {
    const stripeOrder = await createOrder();
    const stripeCheckout = await createCheckout(stripeOrder.id, 'STRIPE');
    expect(stripeCheckout.payment.provider).toBe('STRIPE');

    await request(app.getHttpServer())
      .post('/payments/checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ orderId: stripeOrder.id, provider: 'PAYPAL' })
      .expect(409);

    const stripeEventId = `stage-8-stripe-${randomUUID()}`;
    await postStripeWebhook({
      action: {
        amount: stripeOrder.totalAmount,
        currency: stripeOrder.currency,
        kind: 'PAYMENT_TRANSITION',
        orderId: stripeOrder.id,
        paymentId: stripeCheckout.payment.id,
        providerCheckoutSessionId:
          stripeCheckout.payment.providerCheckoutSessionId,
        providerPaymentId: `stripe-payment-${stripeCheckout.payment.id}`,
        targetStatus: ProviderPaymentStatus.SUCCEEDED,
      },
      eventType: 'payment_intent.succeeded',
      providerEventId: stripeEventId,
    }).expect(200);
    await waitForWebhookStatus(database, stripeEventId, 'PROCESSED');

    const crossProviderResponse = await postPayPalWebhook({
      create_time: new Date().toISOString(),
      event_type: 'PAYFLOW.NAMESPACE.PROOF',
      id: stripeEventId,
      resource: {},
    }).expect(200);
    expect(crossProviderResponse.body).toMatchObject({
      duplicate: false,
      queued: true,
    });
    await waitForWebhookStatus(database, stripeEventId, 'IGNORED', 'PAYPAL');

    const paypalOrder = await createOrder();
    const paypalCheckout = await createCheckout(paypalOrder.id, 'PAYPAL');
    expect(paypalCheckout).toMatchObject({
      payment: { provider: 'PAYPAL', status: 'PENDING' },
    });
    expect(paypalCheckout.checkoutUrl).toMatch(
      /^https:\/\/www\.sandbox\.paypal\.com\//,
    );

    const paypalEventId = `stage-8-paypal-${randomUUID()}`;
    const webhookResponse = await postPayPalWebhook({
      create_time: new Date().toISOString(),
      event_type: 'CHECKOUT.ORDER.APPROVED',
      id: paypalEventId,
      resource: {
        id: paypalCheckout.payment.providerCheckoutSessionId,
        purchase_units: [
          {
            custom_id: paypalCheckout.payment.id,
            invoice_id: paypalOrder.id,
            reference_id: paypalCheckout.payment.id,
          },
        ],
      },
    }).expect(200);
    expect(webhookResponse.body).toMatchObject({
      duplicate: false,
      queued: true,
      received: true,
      status: 'RECEIVED',
    });
    await waitForWebhookStatus(database, paypalEventId, 'PROCESSED', 'PAYPAL');

    await expect(
      database.prisma.payment.findUniqueOrThrow({
        where: { id: paypalCheckout.payment.id },
        select: { providerPaymentId: true, status: true },
      }),
    ).resolves.toEqual({
      providerPaymentId: `paypal-capture-${paypalCheckout.payment.id}`,
      status: 'SUCCEEDED',
    });
    await expect(
      database.prisma.order.findUniqueOrThrow({
        where: { id: paypalOrder.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PAID' });
    expect(paypalSandbox.captureAttemptCount).toBe(2);

    const persisted = await database.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider: 'PAYPAL',
          providerEventId: paypalEventId,
        },
      },
      select: { processingAttempts: true, queueJobId: true, status: true },
    });
    expect(persisted).toMatchObject({
      processingAttempts: 2,
      status: 'PROCESSED',
    });

    const queue = await request(app.getHttpServer())
      .get('/admin/queues/webhooks')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const queueBody = queue.body as AdminWebhookQueueResponseDto;
    expect(queueBody.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptsMade: 2,
          id: persisted.queueJobId,
          state: 'completed',
          webhookEventId: persisted.queueJobId,
        }),
      ]),
    );
  }, 30_000);

  afterAll(async () => {
    await webhookWorker?.close();
    if (database) {
      await database.prisma.webhookEvent.deleteMany({
        where: { providerEventId: { startsWith: 'stage-8-' } },
      });
      const payments = await database.prisma.payment.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      });
      await database.prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: payments.map((payment) => payment.id) } },
      });
      await database.prisma.payment.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await database.prisma.order.deleteMany({
        where: { id: { in: orderIds } },
      });
      await database.prisma.user.deleteMany({ where: { email } });
    }
    await app?.close();
  });

  async function createOrder(): Promise<OrderResponseDto> {
    const response = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ items: [{ productId, quantity: 1 }] })
      .expect(201);
    const order = response.body as OrderResponseDto;
    orderIds.push(order.id);
    return order;
  }

  async function createCheckout(
    orderId: string,
    provider: 'PAYPAL' | 'STRIPE',
  ): Promise<CheckoutSessionResponseDto> {
    const response = await request(app.getHttpServer())
      .post('/payments/checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ orderId, provider })
      .expect(201);
    return response.body as CheckoutSessionResponseDto;
  }

  function postStripeWebhook(payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'stage-8-test-signature')
      .send(JSON.stringify(payload));
  }

  function postPayPalWebhook(payload: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/webhooks/paypal')
      .set('Content-Type', 'application/json')
      .set('PayPal-Auth-Algo', 'SHA256withRSA')
      .set('PayPal-Cert-Url', 'https://api.paypal.com/cert')
      .set('PayPal-Transmission-Id', randomUUID())
      .set('PayPal-Transmission-Sig', 'stage-8-test-signature')
      .set('PayPal-Transmission-Time', new Date().toISOString())
      .send(JSON.stringify(payload));
  }
});
