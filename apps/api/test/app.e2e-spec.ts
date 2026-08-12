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

interface ErrorResponse {
  code: string;
}

describe('PayFlow Stage 2 (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const userEmail = `stage-1-${Date.now()}@example.com`;
  const userPassword = 'Reliable-payments-2026!';
  const orderOwnerEmail = `stage-2-owner-${Date.now()}@example.com`;
  const otherUserEmail = `stage-2-other-${Date.now()}@example.com`;
  let stageTwoOrderId: string | undefined;
  let stageTwoProductId: string | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
      stage: 2,
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
    const otherRegistration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: otherUserEmail, password: userPassword })
      .expect(201);
    const other = otherRegistration.body as unknown as AuthResponseDto;

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
  });

  afterAll(async () => {
    if (database) {
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
