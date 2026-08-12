import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AuditActorType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  RefundStatus,
  WebhookEventStatus,
} from '@payflow/database';

export class AdminCurrencyAmountDto {
  @ApiProperty()
  currency!: string;

  @ApiProperty()
  amount!: number;
}

export class AdminDashboardResponseDto {
  @ApiProperty()
  orderCount!: number;

  @ApiProperty()
  successfulPaymentCount!: number;

  @ApiProperty()
  failedPaymentCount!: number;

  @ApiProperty({
    description: 'Successful refund minor units grouped by currency.',
    type: [AdminCurrencyAmountDto],
  })
  refundTotals!: AdminCurrencyAmountDto[];

  @ApiProperty()
  failedWebhookCount!: number;
}

export class AdminPaginationMetaDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class AdminOrderListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  orderNo!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  totalAmount!: number;

  @ApiProperty()
  customerEmail!: string;

  @ApiProperty()
  itemCount!: number;

  @ApiProperty()
  paymentCount!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminOrdersResponseDto extends AdminPaginationMetaDto {
  @ApiProperty({ type: [AdminOrderListItemDto] })
  items!: AdminOrderListItemDto[];
}

export class AdminOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  unitPriceAmount!: number;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  lineTotalAmount!: number;
}

export class AdminRefundItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiPropertyOptional()
  providerRefundId!: string | null;

  @ApiProperty()
  amount!: number;

  @ApiProperty({ enum: RefundStatus })
  status!: RefundStatus;

  @ApiProperty()
  reason!: string;

  @ApiPropertyOptional()
  failureCode!: string | null;

  @ApiPropertyOptional()
  failureMessage!: string | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  orderNo!: string;

  @ApiProperty()
  customerEmail!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminRefundsResponseDto extends AdminPaginationMetaDto {
  @ApiProperty({ type: [AdminRefundItemDto] })
  items!: AdminRefundItemDto[];
}

export class AdminPaymentItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty()
  orderNo!: string;

  @ApiProperty()
  customerEmail!: string;

  @ApiProperty({ enum: PaymentProvider })
  provider!: PaymentProvider;

  @ApiProperty({ enum: PaymentStatus })
  status!: PaymentStatus;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiPropertyOptional()
  providerPaymentId!: string | null;

  @ApiProperty()
  providerAttemptCount!: number;

  @ApiProperty()
  refundedAmount!: number;

  @ApiProperty()
  reservedRefundAmount!: number;

  @ApiProperty({ type: [AdminRefundItemDto] })
  refunds!: AdminRefundItemDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminPaymentsResponseDto extends AdminPaginationMetaDto {
  @ApiProperty({ type: [AdminPaymentItemDto] })
  items!: AdminPaymentItemDto[];
}

export class AdminPaymentAttemptDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  providerRequestId!: string | null;

  @ApiPropertyOptional()
  errorCode!: string | null;

  @ApiPropertyOptional()
  errorMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminPaymentDetailDto extends AdminPaymentItemDto {
  @ApiPropertyOptional()
  providerCheckoutSessionId!: string | null;

  @ApiProperty({ type: [AdminPaymentAttemptDto] })
  attempts!: AdminPaymentAttemptDto[];
}

export class AdminOrderDetailDto extends AdminOrderListItemDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  subtotalAmount!: number;

  @ApiProperty({ type: [AdminOrderItemDto] })
  items!: AdminOrderItemDto[];

  @ApiProperty({ type: [AdminPaymentDetailDto] })
  payments!: AdminPaymentDetailDto[];
}

export class AdminWebhookItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  provider!: PaymentProvider;

  @ApiProperty()
  providerEventId!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty({ enum: WebhookEventStatus })
  status!: WebhookEventStatus;

  @ApiProperty()
  deliveryCount!: number;

  @ApiPropertyOptional()
  processingError!: string | null;

  @ApiProperty({ format: 'date-time' })
  receivedAt!: string;

  @ApiProperty({ format: 'date-time' })
  lastReceivedAt!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  processedAt!: string | null;
}

export class AdminWebhooksResponseDto extends AdminPaginationMetaDto {
  @ApiProperty({ type: [AdminWebhookItemDto] })
  items!: AdminWebhookItemDto[];
}

export class AdminAuditLogItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: AuditActorType })
  actorType!: AuditActorType;

  @ApiPropertyOptional({ format: 'uuid' })
  actorId!: string | null;

  @ApiPropertyOptional()
  actorEmail!: string | null;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  targetType!: string;

  @ApiProperty()
  targetId!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminAuditLogsResponseDto extends AdminPaginationMetaDto {
  @ApiProperty({ type: [AdminAuditLogItemDto] })
  items!: AdminAuditLogItemDto[];
}
