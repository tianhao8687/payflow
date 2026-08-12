import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { HealthResponseDto } from './dto/health-response.dto';

@Injectable()
export class HealthService {
  constructor(private readonly databaseService: DatabaseService) {}

  async check(): Promise<HealthResponseDto> {
    await this.databaseService.ping();

    return {
      status: 'ok',
      service: 'payflow-api',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'up',
      },
    };
  }
}
