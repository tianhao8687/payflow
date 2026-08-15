import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  LedgerDirection,
  LedgerTransactionType,
  OutboxEventStatus,
  PaymentStatus,
} from '@payflow/database';
import {
  PAYMENT_PROVIDER,
  PAYMENT_PROVIDER_REGISTRY,
  type PaymentProvider,
  PaymentProviderRegistry,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  type ProviderWebhookAction,
  type VerifyWebhookInput,
} from '@payflow/payment-core';
import {
  isRetryableOutboxError,
  OutboxEventStore,
  ReconciliationService,
} from '@payflow/payment-domain';
import {
  createOutboxWorker,
  type OutboxWorker,
  PayFlowOutboxQueue,
  unrecoverable,
  type WebhookWorker,
} from '@payflow/payment-queue';
import request from 'supertest';
import type { App } from 'supertest/types';

import type {
  AdminIntegrityResponseDto,
  AdminReconciliationIssueDto,
} from '../src/admin/dto/admin-response.dto';
import { AppModule } from '../src/app.module';
import type { AuthResponseDto } from '../src/auth/dto/auth-response.dto';
import { DatabaseService } from '../src/database/database.service';
import { ApiExceptionFilter } from '../src/http/api-exception.filter';
import type { OrderResponseDto } from '../src/orders/dto/order-response.dto';
import type { CheckoutSessionResponseDto } from '../src/payments/dto/payment-response.dto';
import type { ProductListResponseDto } from '../src/products/dto/product-list-response.dto';
import { PAYPAL_PAYMENT_PROVIDER } from '../src/providers/payment-provider.module';
import type { CreateRefundResponseDto } from '../src/refunds/dto/refund-response.dto';
import {
  startTestWebhookWorker,
  waitForWebhookStatus,
} from './webhook-worker-harness';

class StageNineProvider implements PaymentProvider {
  private readonly payments = new Map<
    string,
    {
      amount: number;
      currency: string;
      refundedAmount: number;
      status: ProviderPaymentStatus;
    }
  >();

  constructor(readonly name: 'PAYPAL' | 'STRIPE' = 'STRIPE') {}

  isConfigured(): boolean {
    return true;
  }

  async createPayment(input: Parameters<PaymentProvider['createPayment']>[0]) {
    await Promise.resolve();
    const sessionId = `stage-9-session-${input.paymentId}`;
    return {
      amount: input.amount,
      checkoutExpiresAt: new Date(Date.now() + 3_600_000),
      checkoutUrl: `https://checkout.stripe.test/c/${sessionId}`,
      currency: input.currency,
      merchantReference: input.merchantReference,
      providerCheckoutSessionId: sessionId,
      providerPaymentId: null,
      providerRequestId: 'stage-9-create-request',
      status: ProviderPaymentStatus.PENDING,
    };
  }

  async getPayment(providerPaymentId: string) {
    await Promise.resolve();
    const payment = this.payments.get(providerPaymentId);
    if (!payment) {
      throw new Error('Stage 9 provider fixture has no matching payment.');
    }
    return {
      ...payment,
      providerPaymentId,
      providerRequestId: 'stage-9-reconciliation-request',
    };
  }

  async refundPayment(input: Parameters<PaymentProvider['refundPayment']>[0]) {
    await Promise.resolve();
    const payment = this.payments.get(input.providerPaymentId);
    if (!payment) {
      throw new Error('Stage 9 provider fixture has no refundable payment.');
    }
    payment.refundedAmount += input.amount;
    return {
      amount: input.amount,
      currency: input.currency,
      failureCode: null,
      failureMessage: null,
      providerPaymentId: input.providerPaymentId,
      providerRefundId: `stage-9-refund-${input.refundId}`,
      providerRequestId: 'stage-9-refund-request',
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
    if (
      payload.action.kind === 'PAYMENT_TRANSITION' &&
      payload.action.providerPaymentId
    ) {
      this.payments.set(payload.action.providerPaymentId, {
        amount: payload.action.amount!,
        currency: payload.action.currency!,
        refundedAmount: 0,
        status: payload.action.targetStatus,
      });
    }
    return {
      action: payload.action,
      eventType: payload.eventType,
      occurredAt: new Date(),
      payload,
      provider: this.name,
      providerEventId: payload.providerEventId,
    };
  }
}

describe('PayFlow Stage 9 financial integrity acceptance (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let outboxQueue: PayFlowOutboxQueue;
  let outboxWorker: OutboxWorker;
  let webhookWorker: WebhookWorker;
  let userToken: string;
  let adminToken: string;
  let productId: string;
  const provider = new StageNineProvider();
  const paypal = new StageNineProvider('PAYPAL');
  const email = `stage-9-${Date.now()}@example.com`;
  const orderIds: string[] = [];
  const eventIds: string[] = [];
  const refundIds: string[] = [];
  const reconciliationRunIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(provider)
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
    const providers = app.get<PaymentProviderRegistry>(
      PAYMENT_PROVIDER_REGISTRY,
    );
    webhookWorker = startTestWebhookWorker(database, providers);
    await webhookWorker.waitUntilReady();

    const store = new OutboxEventStore(database.prisma);
    outboxQueue = new PayFlowOutboxQueue(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
    );
    outboxWorker = createOutboxWorker(
      process.env.REDIS_URL ?? 'redis://localhost:6379',
      async (job) => {
        await store.beginProcessing(job.data.outboxEventId);
        try {
          await store.postToLedger(job.data.outboxEventId);
        } catch (error: unknown) {
          const retryable = isRetryableOutboxError(error);
          const final =
            !retryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
          await store.recordProcessingFailure(
            job.data.outboxEventId,
            error,
            final,
          );
          throw retryable
            ? error instanceof Error
              ? error
              : new Error('Unknown outbox error.')
            : unrecoverable(error);
        }
      },
      { concurrency: 2 },
    );
    await Promise.all([outboxQueue.ping(), outboxWorker.waitUntilReady()]);

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Stage-9-integrity-user-2026!' })
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
      throw new Error('Stage 9 acceptance requires the committed seed.');
    }
    productId = product.id;
  });

  it('delivers durable money events once and posts only balanced transactions', async () => {
    const order = await createOrder();
    const checkout = await createCheckout(order.id);
    const providerPaymentId = `stage-9-payment-${checkout.payment.id}`;
    const providerEventId = `stage-9-payment-${randomUUID()}`;
    eventIds.push(providerEventId);

    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'stage-9-test-signature')
      .send(
        JSON.stringify({
          action: {
            amount: order.totalAmount,
            currency: order.currency,
            kind: 'PAYMENT_TRANSITION',
            orderId: order.id,
            paymentId: checkout.payment.id,
            providerCheckoutSessionId:
              checkout.payment.providerCheckoutSessionId,
            providerPaymentId,
            targetStatus: ProviderPaymentStatus.SUCCEEDED,
          },
          eventType: 'payment_intent.succeeded',
          providerEventId,
        }),
      )
      .expect(200);
    await waitForWebhookStatus(database, providerEventId, 'PROCESSED');

    const paymentEvent = await database.prisma.outboxEvent.findUniqueOrThrow({
      where: { eventKey: `payment.succeeded:${checkout.payment.id}` },
    });
    expect(paymentEvent.status).toBe(OutboxEventStatus.PENDING);
    await expect(
      database.prisma.payment.findUniqueOrThrow({
        where: { id: checkout.payment.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: PaymentStatus.SUCCEEDED });

    const jobId = await outboxQueue.enqueue(paymentEvent.id);
    await outboxQueue.enqueue(paymentEvent.id);
    await new OutboxEventStore(database.prisma).markPublished(
      paymentEvent.id,
      jobId,
    );
    await waitForOutbox(paymentEvent.id);

    const paymentLedger =
      await database.prisma.ledgerTransaction.findUniqueOrThrow({
        where: { outboxEventId: paymentEvent.id },
        include: { entries: true },
      });
    expect(paymentLedger.entries).toHaveLength(2);
    expect(signedBalance(paymentLedger.entries)).toBe(0);
    await expect(
      database.prisma.ledgerTransaction.count({
        where: { outboxEventId: paymentEvent.id },
      }),
    ).resolves.toBe(1);

    const refundResponse = await request(app.getHttpServer())
      .post(`/admin/payments/${checkout.payment.id}/refunds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: Math.max(1, Math.floor(order.totalAmount / 2)),
        reason: 'Stage 9 balanced refund acceptance.',
        refundRequestId: randomUUID(),
      })
      .expect(201);
    const refund = (refundResponse.body as CreateRefundResponseDto).refund;
    refundIds.push(refund.id);
    const refundEvent = await database.prisma.outboxEvent.findUniqueOrThrow({
      where: { eventKey: `refund.succeeded:${refund.id}` },
    });
    const refundJobId = await outboxQueue.enqueue(refundEvent.id);
    await new OutboxEventStore(database.prisma).markPublished(
      refundEvent.id,
      refundJobId,
    );
    await waitForOutbox(refundEvent.id);
    const refundLedger =
      await database.prisma.ledgerTransaction.findUniqueOrThrow({
        where: { outboxEventId: refundEvent.id },
        include: { entries: true },
      });
    expect(refundLedger.transactionType).toBe(LedgerTransactionType.REFUND);
    expect(signedBalance(refundLedger.entries)).toBe(0);

    await expectUnbalancedLedgerRejected(paymentEvent.aggregateId);

    const tamperedAt = new Date();
    await database.prisma.payment.update({
      where: { id: checkout.payment.id },
      data: { status: PaymentStatus.FAILED },
    });
    const reconciliation = new ReconciliationService(
      database.prisma,
      app.get<PaymentProviderRegistry>(PAYMENT_PROVIDER_REGISTRY),
    );
    const run = await reconciliation.run({
      windowEnd: new Date(Date.now() + 1_000),
      windowStart: new Date(tamperedAt.getTime() - 1_000),
    });
    reconciliationRunIds.push(run.id);
    expect(run.issueCount).toBeGreaterThanOrEqual(1);

    const integrityResponse = await request(app.getHttpServer())
      .get('/admin/integrity')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const integrity = integrityResponse.body as AdminIntegrityResponseDto;
    expect(integrity.ledgerTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          balance: 0,
          id: paymentLedger.id,
        }),
      ]),
    );
    const issue = integrity.reconciliationIssues.find(
      (item) =>
        item.paymentId === checkout.payment.id &&
        item.issueType === 'STATUS_MISMATCH' &&
        item.status === 'OPEN',
    );
    expect(issue).toBeDefined();

    await request(app.getHttpServer())
      .get('/admin/integrity')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/admin/reconciliation/issues/${issue!.id}/resolve`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    const resolvedResponse = await request(app.getHttpServer())
      .patch(`/admin/reconciliation/issues/${issue!.id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((resolvedResponse.body as AdminReconciliationIssueDto).status).toBe(
      'RESOLVED',
    );
    await expect(
      database.prisma.auditLog.count({
        where: {
          action: 'RECONCILIATION_ISSUE_RESOLVED',
          targetId: issue!.id,
        },
      }),
    ).resolves.toBe(1);
  }, 30_000);

  afterAll(async () => {
    await Promise.allSettled([
      outboxWorker?.close(),
      outboxQueue?.close(),
      webhookWorker?.close(),
    ]);
    if (database) {
      const payments = await database.prisma.payment.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      });
      const paymentIds = payments.map((payment) => payment.id);
      const reconciliationIssues =
        await database.prisma.reconciliationIssue.findMany({
          where: { runId: { in: reconciliationRunIds } },
          select: { id: true },
        });
      await database.prisma.reconciliationIssue.deleteMany({
        where: { runId: { in: reconciliationRunIds } },
      });
      await database.prisma.reconciliationRun.deleteMany({
        where: { id: { in: reconciliationRunIds } },
      });
      const outbox = await database.prisma.outboxEvent.findMany({
        where: {
          aggregateId: { in: [...paymentIds, ...refundIds] },
        },
        select: { id: true },
      });
      const ledgerTransactions =
        await database.prisma.ledgerTransaction.findMany({
          where: { outboxEventId: { in: outbox.map((event) => event.id) } },
          select: { id: true },
        });
      await database.prisma.auditLog.deleteMany({
        where: {
          targetId: {
            in: [
              ...refundIds,
              ...reconciliationIssues.map((issue) => issue.id),
              ...ledgerTransactions.map((transaction) => transaction.id),
            ],
          },
        },
      });
      await database.prisma.ledgerTransaction.deleteMany({
        where: { outboxEventId: { in: outbox.map((event) => event.id) } },
      });
      await database.prisma.outboxEvent.deleteMany({
        where: { id: { in: outbox.map((event) => event.id) } },
      });
      await database.prisma.webhookEvent.deleteMany({
        where: { providerEventId: { in: eventIds } },
      });
      await database.prisma.refund.deleteMany({
        where: { id: { in: refundIds } },
      });
      await database.prisma.payment.deleteMany({
        where: { id: { in: paymentIds } },
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
  ): Promise<CheckoutSessionResponseDto> {
    const response = await request(app.getHttpServer())
      .post('/payments/checkout-session')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ orderId, provider: 'STRIPE' })
      .expect(201);
    return response.body as CheckoutSessionResponseDto;
  }

  async function waitForOutbox(id: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const event = await database.prisma.outboxEvent.findUnique({
        where: { id },
        select: { status: true },
      });
      if (event?.status === OutboxEventStatus.PROCESSED) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Outbox event ${id} was not processed.`);
  }

  async function expectUnbalancedLedgerRejected(
    aggregateId: string,
  ): Promise<void> {
    await expect(
      database.prisma.$transaction(async (transaction) => {
        const outbox = await transaction.outboxEvent.create({
          data: {
            aggregateId,
            aggregateType: 'PAYMENT',
            eventKey: `stage-9-unbalanced:${randomUUID()}`,
            eventType: 'PAYMENT_SUCCEEDED',
            payloadJson: {},
          },
        });
        const account = await transaction.ledgerAccount.findFirstOrThrow();
        await transaction.ledgerTransaction.create({
          data: {
            currency: account.currency,
            entries: {
              create: {
                accountId: account.id,
                amount: 1,
                currency: account.currency,
                direction: LedgerDirection.DEBIT,
              },
            },
            outboxEventId: outbox.id,
            referenceId: aggregateId,
            referenceType: 'PAYMENT',
            transactionType: LedgerTransactionType.PAYMENT,
          },
        });
      }),
    ).rejects.toThrow(/zero signed balance/);
  }
});

function signedBalance(
  entries: Array<{ amount: number; direction: LedgerDirection }>,
): number {
  return entries.reduce(
    (sum, entry) =>
      sum +
      (entry.direction === LedgerDirection.DEBIT
        ? entry.amount
        : -entry.amount),
    0,
  );
}
