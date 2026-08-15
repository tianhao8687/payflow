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
    description:
      'True when the durable inbox accepted the event for asynchronous dispatch',
    example: true,
  })
  queued!: boolean;
}
