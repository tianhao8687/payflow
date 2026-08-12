import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PayFlowWebhookQueue,
  type WebhookQueueSnapshot,
} from '@payflow/payment-queue';

import type { ApiEnvironment } from '../config/environment';

@Injectable()
export class WebhookQueueService implements OnModuleDestroy {
  private readonly queue: PayFlowWebhookQueue;

  constructor(config: ConfigService<ApiEnvironment, true>) {
    this.queue = new PayFlowWebhookQueue(
      config.get('REDIS_URL', { infer: true }),
    );
  }

  enqueue(webhookEventId: string): Promise<string> {
    return this.queue.enqueue(webhookEventId);
  }

  ping(): Promise<void> {
    return this.queue.ping();
  }

  snapshot(limit?: number): Promise<WebhookQueueSnapshot> {
    return this.queue.snapshot(limit);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
