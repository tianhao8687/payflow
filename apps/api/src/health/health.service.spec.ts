import { Test, TestingModule } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service';
import { WebhookQueueService } from '../queue/webhook-queue.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  const databaseService = {
    ping: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };
  const webhookQueue = {
    ping: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    databaseService.ping.mockClear();
    webhookQueue.ping.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: DatabaseService,
          useValue: databaseService,
        },
        {
          provide: WebhookQueueService,
          useValue: webhookQueue,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('reports the database as available after a successful ping', async () => {
    await expect(service.check()).resolves.toMatchObject({
      status: 'ok',
      service: 'payflow-api',
      checks: { database: 'up', redis: 'up' },
    });
    expect(databaseService.ping).toHaveBeenCalledTimes(1);
    expect(webhookQueue.ping).toHaveBeenCalledTimes(1);
  });
});
