import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { AuthResponseDto } from './../src/auth/dto/auth-response.dto';
import { UserResponseDto } from './../src/auth/dto/user-response.dto';
import { DatabaseService } from './../src/database/database.service';
import { ApiExceptionFilter } from './../src/http/api-exception.filter';
import { ProductListResponseDto } from './../src/products/dto/product-list-response.dto';
import { ProductResponseDto } from './../src/products/dto/product-response.dto';
import { OrderResponseDto } from './../src/orders/dto/order-response.dto';
import { CheckoutSessionResponseDto } from './../src/payments/dto/payment-response.dto';
import {
  type CreateStripeCheckoutInput,
  type StripeCheckoutResult,
  StripeCheckoutGateway,
} from './../src/payments/stripe-checkout.gateway';

interface ErrorResponse {
  code: string;
}

class FakeStripeCheckoutGateway {
  readonly inputs: CreateStripeCheckoutInput[] = [];
  private readonly sessions = new Map<string, StripeCheckoutResult>();

  isConfigured(): boolean {
    return true;
  }

  async createCheckoutSession(
    input: CreateStripeCheckoutInput,
  ): Promise<StripeCheckoutResult> {
    this.inputs.push(input);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const replay = this.sessions.get(input.idempotencyKey);
    if (replay) {
      return replay;
    }

    const result: StripeCheckoutResult = {
      amountTotal: input.amount,
      currency: input.currency,
      expiresAt: new Date(Date.now() + 86_400_000),
      paymentIntentId: null,
      requestId: `req_test_${this.sessions.size + 1}`,
      sessionId: `cs_test_${this.sessions.size + 1}`,
      url: `https://checkout.stripe.test/c/payflow_${this.sessions.size + 1}`,
    };
    this.sessions.set(input.idempotencyKey, result);
    return result;
  }

  get uniqueSessionCount(): number {
    return this.sessions.size;
  }
}

describe('PayFlow Stage 3 (e2e)', () => {
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
  let stageThreeRaceOrderId: string | undefined;
  const fakeStripe = new FakeStripeCheckoutGateway();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StripeCheckoutGateway)
      .useValue(fakeStripe)
      .compile();

    app = moduleFixture.createNestApplication();
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
      stage: 3,
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
      if (stageThreeOrderId) {
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
});
