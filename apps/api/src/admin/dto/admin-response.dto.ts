import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AuditActorType,
  LedgerDirection,
  LedgerTransactionType,
  OrderStatus,
  OutboxEventStatus,
  PaymentProvider,
  PaymentStatus,
  ReconciliationIssueStatus,
  ReconciliationIssueType,
  ReconciliationRunStatus,
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

  @ApiProperty()
  pendingOutboxEventCount!: number;

  @ApiProperty()
  openReconciliationIssueCount!: number;
}

export class AdminOutboxEventDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  eventKey!: string;

  @ApiProperty()
  aggregateType!: string;

  @ApiProperty({ format: 'uuid' })
  aggregateId!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty({ enum: OutboxEventStatus })
  status!: OutboxEventStatus;

  @ApiProperty()
  publishAttempts!: number;

  @ApiProperty()
  processingAttempts!: number;

  @ApiPropertyOptional()
  queueJobId!: string | null;

  @ApiPropertyOptional()
  lastError!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  publishedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  processedAt!: string | null;
}

export class AdminLedgerEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  accountCode!: string;

  @ApiProperty()
  accountName!: string;

  @ApiProperty({ enum: LedgerDirection })
  direction!: LedgerDirection;

  @ApiProperty()
  amount!: number;

  @ApiProperty()
  currency!: string;
}

export class AdminLedgerTransactionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  outboxEventId!: string;

  @ApiProperty({ enum: LedgerTransactionType })
  transactionType!: LedgerTransactionType;

  @ApiProperty()
  referenceType!: string;

  @ApiProperty({ format: 'uuid' })
  referenceId!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ description: 'Debit minus credit in minor units.' })
  balance!: number;

  @ApiProperty({ type: [AdminLedgerEntryDto] })
  entries!: AdminLedgerEntryDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class AdminReconciliationRunDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ReconciliationRunStatus })
  status!: ReconciliationRunStatus;

  @ApiProperty()
  checkedCount!: number;

  @ApiProperty()
  passedCount!: number;

  @ApiProperty()
  issueCount!: number;

  @ApiProperty()
  errorCount!: number;

  @ApiProperty({ format: 'date-time' })
  windowStart!: string;

  @ApiProperty({ format: 'date-time' })
  windowEnd!: string;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  completedAt!: string | null;
}

export class AdminReconciliationIssueDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty()
  orderNo!: string;

  @ApiProperty()
  customerEmail!: string;

  @ApiProperty({ enum: PaymentProvider })
  provider!: PaymentProvider;

  @ApiProperty({ enum: ReconciliationIssueType })
  issueType!: ReconciliationIssueType;

  @ApiProperty({ enum: ReconciliationIssueStatus })
  status!: ReconciliationIssueStatus;

  @ApiProperty({ type: 'object', additionalProperties: true })
  localSnapshot!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  providerSnapshot!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  detectedAt!: string;

  @ApiProperty({ format: 'date-time' })
  lastSeenAt!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  resolvedAt!: string | null;
}

export class AdminIntegrityResponseDto {
  @ApiProperty({ additionalProperties: { type: 'number' }, type: 'object' })
  outboxCounts!: Record<string, number>;

  @ApiProperty({ type: [AdminOutboxEventDto] })
  outboxEvents!: AdminOutboxEventDto[];

  @ApiProperty({ type: [AdminLedgerTransactionDto] })
  ledgerTransactions!: AdminLedgerTransactionDto[];

  @ApiProperty({ type: [AdminReconciliationRunDto] })
  reconciliationRuns!: AdminReconciliationRunDto[];

  @ApiProperty({ type: [AdminReconciliationIssueDto] })
  reconciliationIssues!: AdminReconciliationIssueDto[];
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

  @ApiProperty()
  processingAttempts!: number;

  @ApiProperty()
  dispatchAttempts!: number;

  @ApiPropertyOptional()
  dispatchError!: string | null;

  @ApiProperty({ format: 'date-time' })
  nextDispatchAt!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  lastDispatchAttemptAt!: string | null;

  @ApiPropertyOptional()
  queueJobId!: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  queuedAt!: string | null;

  @ApiPropertyOptional()
  processingError!: string | null;

  @ApiProperty({ format: 'date-time' })
  receivedAt!: string;

  @ApiProperty({ format: 'date-time' })
  lastReceivedAt!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  processedAt!: string | null;
}

export class AdminWebhookQueueJobDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'uuid' })
  webhookEventId!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty()
  attemptsMade!: number;

  @ApiProperty()
  attemptsTotal!: number;

  @ApiPropertyOptional()
  failedReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  processedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  finishedAt!: string | null;
}

export class AdminWebhookQueueResponseDto {
  @ApiProperty({
    additionalProperties: { type: 'number' },
    type: 'object',
  })
  counts!: Record<string, number>;

  @ApiProperty({ type: [AdminWebhookQueueJobDto] })
  jobs!: AdminWebhookQueueJobDto[];
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
