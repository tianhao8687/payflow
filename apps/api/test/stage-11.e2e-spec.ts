import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentProvider as DatabasePaymentProvider } from '@payflow/database';
import { AlipayProvider, type AlipaySdkLike } from '@payflow/payment-alipay';
import {
  PAYMENT_PROVIDER_REGISTRY,
  PaymentProviderRegistry,
} from '@payflow/payment-core';
import {
  inboxDispatchRetryDelayMs,
  WebhookEventStore,
} from '@payflow/payment-domain';
import type { WebhookWorker } from '@payflow/payment-queue';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import type { AuthResponseDto } from '../src/auth/dto/auth-response.dto';
import { DatabaseService } from '../src/database/database.service';
import { ApiExceptionFilter } from '../src/http/api-exception.filter';
import type { OrderResponseDto } from '../src/orders/dto/order-response.dto';
import type { CheckoutSessionResponseDto } from '../src/payments/dto/payment-response.dto';
import {
  startTestWebhookWorker,
  waitForWebhookStatus,
} from './webhook-worker-harness';

describe('Stage 11 Alipay durable inbox acceptance (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let worker: WebhookWorker | undefined;
  let orderId: string | undefined;
  let paymentId: string | undefined;
  let productId: string | undefined;
  const email = `stage-11-${Date.now()}@example.com`;
  const eventPrefix = `alipay-stage-11-${Date.now()}`;
  const pageExecute = jest.fn<
    ReturnType<AlipaySdkLike['pageExecute']>,
    Parameters<AlipaySdkLike['pageExecute']>
  >(() => 'https://openapi-sandbox.dl.alipaydev.com/gateway.do?sign=test-only');
  const sdk: AlipaySdkLike = {
    checkNotifySignV2: (value) =>
      isRecord(value) && value.sign === 'test-valid-signature',
    exec: () => Promise.reject(new Error('No query expected in this test.')),
    pageExecute,
  };
  const alipay = new AlipayProvider({
    alipayPublicKey: 'test-only-sandbox-public-key',
    appId: 'stage-11-app-id',
    enabled: true,
    environment: 'sandbox',
    gatewayUrl: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
    notifyUrl: 'http://localhost:4000/webhooks/alipay',
    privateKey: 'test-only-sandbox-private-key',
    returnUrl:
      'http://localhost:3000/payments/{paymentId}/result?provider=alipay',
    sdk,
    sellerId: 'stage-11-seller-id',
  });
  const registry = new PaymentProviderRegistry([alipay]);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_PROVIDER_REGISTRY)
      .useValue(registry)
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

  it('uses one CNY merchant reference across five concurrent checkouts', async () => {
    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Stage-11-reliable-payments!' })
      .expect(201);
    const token = (registration.body as AuthResponseDto).accessToken;
    const product = await database.prisma.product.create({
      data: {
        active: true,
        currency: 'CNY',
        name: 'Stage 11 Alipay Sandbox Fixture',
        priceAmount: 12_345,
        sku: `PF-S11-${Date.now()}`,
        stock: 10,
      },
    });
    productId = product.id;
    const orderResponse = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ productId: product.id, quantity: 1 }] })
      .expect(201);
    const order = orderResponse.body as OrderResponseDto;
    orderId = order.id;

    const checkouts = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/payments/checkout-session')
          .set('Authorization', `Bearer ${token}`)
          .send({ orderId: order.id, provider: 'ALIPAY' }),
      ),
    );
    expect(checkouts.map((response) => response.status)).toEqual([
      201, 201, 201, 201, 201,
    ]);
    const checkoutBodies = checkouts.map(
      (response) => response.body as CheckoutSessionResponseDto,
    );
    paymentId = checkoutBodies[0].payment.id;
    expect(new Set(checkoutBodies.map((item) => item.payment.id)).size).toBe(1);
    expect(new Set(checkoutBodies.map((item) => item.checkoutUrl)).size).toBe(
      1,
    );
    expect(checkoutBodies[0]).toMatchObject({
      payment: {
        currency: 'CNY',
        merchantReference: paymentId,
        provider: 'ALIPAY',
        providerCheckoutSessionId: null,
        providerPaymentId: null,
        status: 'PENDING',
      },
    });
    expect(pageExecute).toHaveBeenCalled();
    expect(
      new Set(
        pageExecute.mock.calls.map(([, , parameters]) =>
          String((parameters.bizContent as Record<string, unknown>).outTradeNo),
        ),
      ),
    ).toEqual(new Set([paymentId]));

    const forgedReturn = await request(app.getHttpServer())
      .get(`/payments/${paymentId}?trade_status=TRADE_SUCCESS`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(forgedReturn.body).toMatchObject({ status: 'PENDING' });

    const successfulForm = notification({
      notifyId: `${eventPrefix}-success`,
      outTradeNo: paymentId,
      status: 'TRADE_SUCCESS',
      totalAmount: '123.45',
    });
    const acknowledged = await sendNotification(successfulForm)
      .expect('Content-Type', /text\/plain/)
      .expect(200);
    expect(acknowledged.text).toBe('success');

    const received = await database.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider: DatabasePaymentProvider.ALIPAY,
          providerEventId: successfulForm.notify_id,
        },
      },
    });
    expect(received.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(received.eventFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(received).toMatchObject({
      queueJobId: null,
      queuedAt: null,
      status: 'RECEIVED',
    });
    expect(JSON.stringify(received.payloadJson)).not.toContain('buyer');

    const inboxStore = new WebhookEventStore(database.prisma);
    const dispatchAttempt = await inboxStore.beginDispatchAttempt(received.id);
    expect(dispatchAttempt).toBe(1);
    if (dispatchAttempt === null) {
      throw new Error('Expected the durable inbox row to be dispatchable.');
    }
    const retry = await inboxStore.recordDispatchFailure(
      received.id,
      dispatchAttempt,
      new Error('simulated Redis outage'),
    );
    expect(retry).toMatchObject({
      retryDelayMs: inboxDispatchRetryDelayMs(received.id, 1),
    });
    expect(retry?.nextDispatchAt.getTime()).toBeGreaterThan(Date.now());
    expect(
      (await inboxStore.listUndispatched(200)).some(
        (event) => event.id === received.id,
      ),
    ).toBe(false);
    await database.prisma.webhookEvent.update({
      where: { id: received.id },
      data: { nextDispatchAt: new Date(Date.now() - 1_000) },
    });

    worker = startTestWebhookWorker(database, registry);
    await worker.waitUntilReady();
    await waitForWebhookStatus(
      database,
      successfulForm.notify_id,
      'PROCESSED',
      'ALIPAY',
    );
    await expect(
      database.prisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { providerPaymentId: true, status: true },
      }),
    ).resolves.toEqual({
      providerPaymentId: successfulForm.trade_no,
      status: 'SUCCEEDED',
    });

    await database.prisma.webhookEvent.update({
      where: { id: received.id },
      data: { eventFingerprint: null },
    });
    const conflict = await sendNotification({
      ...successfulForm,
      trade_no: '2026081500000999999',
    }).expect(400);
    expect(conflict.text).toContain('WEBHOOK_EVENT_ID_CONFLICT');
    await expect(
      database.prisma.webhookEvent.findUniqueOrThrow({
        where: {
          provider_providerEventId: {
            provider: DatabasePaymentProvider.ALIPAY,
            providerEventId: successfulForm.notify_id,
          },
        },
        select: { deliveryCount: true, eventFingerprint: true, status: true },
      }),
    ).resolves.toEqual({
      deliveryCount: 1,
      eventFingerprint: null,
      status: 'PROCESSED',
    });

    await sendNotification(successfulForm).expect(200).expect('success');
    const reboundEvent = await database.prisma.webhookEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider: DatabasePaymentProvider.ALIPAY,
          providerEventId: successfulForm.notify_id,
        },
      },
      select: { deliveryCount: true, eventFingerprint: true, status: true },
    });
    expect(reboundEvent).toMatchObject({
      deliveryCount: 2,
      status: 'PROCESSED',
    });
    expect(reboundEvent.eventFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const closedForm = notification({
      notifyId: `${eventPrefix}-late-closed`,
      outTradeNo: paymentId,
      status: 'TRADE_CLOSED',
      totalAmount: '123.45',
    });
    await sendNotification(closedForm).expect(200).expect('success');
    await waitForWebhookStatus(
      database,
      closedForm.notify_id,
      'IGNORED',
      'ALIPAY',
    );
    await expect(
      database.prisma.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'SUCCEEDED' });

    await sendNotification({
      ...notification({
        notifyId: `${eventPrefix}-wrong-amount`,
        outTradeNo: paymentId,
        status: 'TRADE_SUCCESS',
        totalAmount: '123.46',
      }),
    }).expect(400);
    await expect(
      database.prisma.webhookEvent.count({
        where: { providerEventId: `${eventPrefix}-wrong-amount` },
      }),
    ).resolves.toBe(0);

    await sendNotification(
      notification({
        notifyId: `${eventPrefix}-wrong-refunded-close`,
        outTradeNo: paymentId,
        refundFee: '10.00',
        status: 'TRADE_CLOSED',
        totalAmount: '123.46',
      }),
    ).expect(400);
    await expect(
      database.prisma.webhookEvent.count({
        where: {
          providerEventId: `${eventPrefix}-wrong-refunded-close`,
        },
      }),
    ).resolves.toBe(0);
  });

  afterAll(async () => {
    await worker?.close();
    if (database) {
      await database.prisma.webhookEvent.deleteMany({
        where: { providerEventId: { startsWith: eventPrefix } },
      });
      if (paymentId) {
        await database.prisma.outboxEvent.deleteMany({
          where: { aggregateId: paymentId },
        });
        await database.prisma.payment.deleteMany({
          where: { id: paymentId },
        });
      }
      if (orderId) {
        await database.prisma.order.deleteMany({ where: { id: orderId } });
      }
      if (productId) {
        await database.prisma.product.deleteMany({ where: { id: productId } });
      }
      await database.prisma.user.deleteMany({ where: { email } });
    }
    await app?.close();
  });

  function sendNotification(form: Record<string, string>) {
    return request(app.getHttpServer())
      .post('/webhooks/alipay')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(new URLSearchParams(form).toString());
  }
});

function notification(input: {
  notifyId: string;
  outTradeNo: string;
  refundFee?: string;
  status: 'TRADE_CLOSED' | 'TRADE_SUCCESS';
  totalAmount: string;
}): Record<string, string> {
  return {
    app_id: 'stage-11-app-id',
    buyer_id: 'must-not-be-persisted',
    notify_id: input.notifyId,
    notify_time: '2026-08-15 20:30:00',
    out_trade_no: input.outTradeNo,
    ...(input.refundFee ? { refund_fee: input.refundFee } : {}),
    seller_id: 'stage-11-seller-id',
    sign: 'test-valid-signature',
    total_amount: input.totalAmount,
    trade_no: '2026081500000112345',
    trade_status: input.status,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
