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

interface ErrorResponse {
  code: string;
}

describe('PayFlow Stage 1 (e2e)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  const userEmail = `stage-1-${Date.now()}@example.com`;
  const userPassword = 'Reliable-payments-2026!';

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
      stage: 1,
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

  afterAll(async () => {
    if (database) {
      await database.prisma.user.deleteMany({
        where: { email: { in: [userEmail, `role-${userEmail}`] } },
      });
    }
    await app?.close();
  });
});
