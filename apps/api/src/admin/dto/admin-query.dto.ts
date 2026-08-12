import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  RefundStatus,
  WebhookEventStatus,
} from '@payflow/database';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AdminPaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class AdminOrdersQueryDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({ description: 'Order number or customer email.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class AdminPaymentsQueryDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentProvider })
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @ApiPropertyOptional({
    description: 'Provider payment ID, order number, or customer email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;
}

export class AdminRefundsQueryDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Provider refund ID, order number, or customer email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @ApiPropertyOptional({ enum: RefundStatus })
  @IsOptional()
  @IsEnum(RefundStatus)
  status?: RefundStatus;
}

export class AdminWebhooksQueryDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({ example: 'refund.updated' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  eventType?: string;

  @ApiPropertyOptional({ enum: WebhookEventStatus })
  @IsOptional()
  @IsEnum(WebhookEventStatus)
  status?: WebhookEventStatus;
}

export class AdminAuditLogsQueryDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({ example: 'REFUND_REQUESTED' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;
}
