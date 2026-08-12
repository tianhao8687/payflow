import { ApiProperty } from '@nestjs/swagger';
import { WebhookEventStatus } from '@payflow/database';

export class WebhookResponseDto {
  @ApiProperty({ example: true })
  received!: true;

  @ApiProperty({
    description: 'True when provider_event_id was already persisted',
    example: false,
  })
  duplicate!: boolean;

  @ApiProperty({ enum: WebhookEventStatus })
  status!: WebhookEventStatus;

  @ApiProperty({
    description: 'True when a BullMQ job exists for asynchronous processing',
    example: true,
  })
  queued!: boolean;
}
