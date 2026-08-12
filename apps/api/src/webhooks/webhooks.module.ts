import { Module } from '@nestjs/common';

import { StripeWebhookVerifier } from './stripe-webhook.verifier';
import { WebhooksController } from './webhooks.controller';
import { WebhooksRepository } from './webhooks.repository';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [WebhooksController],
  providers: [StripeWebhookVerifier, WebhooksRepository, WebhooksService],
})
export class WebhooksModule {}
