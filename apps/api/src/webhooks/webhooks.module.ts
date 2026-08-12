import { Module } from '@nestjs/common';

import { WebhooksController } from './webhooks.controller';
import { WebhooksRepository } from './webhooks.repository';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksRepository, WebhooksService],
})
export class WebhooksModule {}
