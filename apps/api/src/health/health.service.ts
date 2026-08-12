import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { WebhookQueueService } from '../queue/webhook-queue.service';
import { HealthResponseDto } from './dto/health-response.dto';

@Injectable()
export class HealthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly webhookQueue: WebhookQueueService,
  ) {}

  async check(): Promise<HealthResponseDto> {
    await Promise.all([this.databaseService.ping(), this.webhookQueue.ping()]);

    return {
      status: 'ok',
      service: 'payflow-api',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'up',
        redis: 'up',
      },
    };
  }
}
