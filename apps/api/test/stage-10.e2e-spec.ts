import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { ApiExceptionFilter } from './../src/http/api-exception.filter';

interface HealthResponseBody {
  checks: { database: string; redis: string };
  service: string;
  status: string;
  timestamp: string;
}

describe('PayFlow Stage 10 observability acceptance (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('checks PostgreSQL and Redis and preserves the caller request ID', async () => {
    const requestId = `stage-10-${Date.now()}`;
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', requestId)
      .expect(200)
      .expect('x-request-id', requestId);

    const body = response.body as HealthResponseBody;
    expect(body).toMatchObject({
      checks: { database: 'up', redis: 'up' },
      service: 'payflow-api',
      status: 'ok',
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('reports the completed implementation stage', async () => {
    await request(app.getHttpServer()).get('/').expect(200).expect({
      docs: '/docs',
      health: '/health',
      service: 'PayFlow API',
      stage: 10,
    });
  });
});
