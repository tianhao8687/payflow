import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient, PrismaClient } from '@payflow/database';

import type { ApiEnvironment } from '../config/environment';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor(configService: ConfigService<ApiEnvironment, true>) {
    this.client = createPrismaClient(
      configService.get('DATABASE_URL', { infer: true }),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async ping(): Promise<void> {
    await this.client.$queryRawUnsafe('SELECT 1');
  }

  get prisma(): PrismaClient {
    return this.client;
  }
}
