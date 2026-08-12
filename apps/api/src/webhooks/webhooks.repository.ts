import { Injectable } from '@nestjs/common';
import { WebhookEventStatus } from '@payflow/database';
import { type VerifiedWebhookEvent } from '@payflow/payment-core';
import { WebhookEventStore } from '@payflow/payment-domain';
import { recordWebhookDuplicate } from '@payflow/observability';

import { DatabaseService } from '../database/database.service';
import { WebhookQueueService } from '../queue/webhook-queue.service';

export interface WebhookProcessingResult {
  duplicate: boolean;
  queued: boolean;
  status: WebhookEventStatus;
}

@Injectable()
export class WebhooksRepository {
  private readonly store: WebhookEventStore;

  constructor(
    database: DatabaseService,
    private readonly queue: WebhookQueueService,
  ) {
    this.store = new WebhookEventStore(database.prisma);
  }

  async processProviderEvent(
    event: VerifiedWebhookEvent,
  ): Promise<WebhookProcessingResult> {
    const receipt = await this.store.receive(event);
    if (receipt.duplicate) {
      recordWebhookDuplicate({ provider: event.provider });
    }
    if (!receipt.enqueue) {
      return {
        duplicate: receipt.duplicate,
        queued: false,
        status: receipt.status,
      };
    }

    const jobId = await this.queue.enqueue(receipt.eventId);
    await this.store.markQueued(receipt.eventId, jobId);

    return {
      duplicate: receipt.duplicate,
      queued: true,
      status: receipt.status,
    };
  }
}
