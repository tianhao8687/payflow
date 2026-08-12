import { Test, TestingModule } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  const databaseService = {
    ping: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    databaseService.ping.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: DatabaseService,
          useValue: databaseService,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('reports the database as available after a successful ping', async () => {
    await expect(service.check()).resolves.toMatchObject({
      status: 'ok',
      service: 'payflow-api',
      checks: { database: 'up' },
    });
    expect(databaseService.ping).toHaveBeenCalledTimes(1);
  });
});
