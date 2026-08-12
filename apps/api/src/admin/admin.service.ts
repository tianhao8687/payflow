import { Injectable, NotFoundException } from '@nestjs/common';
import {
  LedgerDirection,
  OutboxEventStatus,
  RefundStatus,
  type Refund,
} from '@payflow/database';

import { WebhookQueueService } from '../queue/webhook-queue.service';

import {
  AdminRepository,
  type AdminPaymentDetailRecord,
  type AdminPaymentRecord,
  type AdminReconciliationIssueRecord,
} from './admin.repository';
import type {
  AdminAuditLogsQueryDto,
  AdminOrdersQueryDto,
  AdminPaymentsQueryDto,
  AdminRefundsQueryDto,
  AdminWebhooksQueryDto,
} from './dto/admin-query.dto';
import {
  AdminAuditLogItemDto,
  AdminAuditLogsResponseDto,
  AdminDashboardResponseDto,
  AdminIntegrityResponseDto,
  AdminOrderDetailDto,
  AdminOrderListItemDto,
  AdminOrdersResponseDto,
  AdminPaymentDetailDto,
  AdminPaymentItemDto,
  AdminPaymentsResponseDto,
  AdminRefundItemDto,
  AdminRefundsResponseDto,
  AdminReconciliationIssueDto,
  AdminWebhookItemDto,
  AdminWebhooksResponseDto,
  AdminWebhookQueueResponseDto,
} from './dto/admin-response.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly adminRepository: AdminRepository,
    private readonly webhookQueue: WebhookQueueService,
  ) {}

  async dashboard(): Promise<AdminDashboardResponseDto> {
    const dashboard = await this.adminRepository.dashboard();

    return {
      failedPaymentCount: dashboard.failedPaymentCount,
      failedWebhookCount: dashboard.failedWebhookCount,
      openReconciliationIssueCount: dashboard.openReconciliationIssueCount,
      orderCount: dashboard.orderCount,
      pendingOutboxEventCount: dashboard.pendingOutboxEventCount,
      refundTotals: dashboard.refundTotals.map((total) => ({
        amount: Number(total.amount),
        currency: total.currency,
      })),
      successfulPaymentCount: dashboard.successfulPaymentCount,
    };
  }

  async orders(query: AdminOrdersQueryDto): Promise<AdminOrdersResponseDto> {
    const result = await this.adminRepository.listOrders(query);

    return {
      ...pagination(query, result.total),
      items: result.items.map((order): AdminOrderListItemDto => ({
        createdAt: order.createdAt.toISOString(),
        currency: order.currency,
        customerEmail: order.user.email,
        id: order.id,
        itemCount: order._count.items,
        orderNo: order.orderNo,
        paymentCount: order._count.payments,
        status: order.status,
        totalAmount: order.totalAmount,
      })),
    };
  }

  async order(id: string): Promise<AdminOrderDetailDto> {
    const order = await this.adminRepository.findOrder(id);

    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found.',
      });
    }

    return {
      createdAt: order.createdAt.toISOString(),
      currency: order.currency,
      customerEmail: order.user.email,
      id: order.id,
      itemCount: order.items.length,
      items: order.items.map((item) => ({
        id: item.id,
        lineTotalAmount: item.lineTotalAmount,
        name: item.nameSnapshot,
        quantity: item.quantity,
        sku: item.skuSnapshot,
        unitPriceAmount: item.unitPriceAmount,
      })),
      orderNo: order.orderNo,
      paymentCount: order.payments.length,
      payments: order.payments.map((payment) => this.paymentDetail(payment)),
      status: order.status,
      subtotalAmount: order.subtotalAmount,
      totalAmount: order.totalAmount,
      userId: order.userId,
    };
  }

  async payments(
    query: AdminPaymentsQueryDto,
  ): Promise<AdminPaymentsResponseDto> {
    const result = await this.adminRepository.listPayments(query);

    return {
      ...pagination(query, result.total),
      items: result.items.map((payment) => this.paymentItem(payment)),
    };
  }

  async payment(id: string): Promise<AdminPaymentDetailDto> {
    const payment = await this.adminRepository.findPayment(id);

    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found.',
      });
    }

    return this.paymentDetail(payment);
  }

  async refunds(query: AdminRefundsQueryDto): Promise<AdminRefundsResponseDto> {
    const result = await this.adminRepository.listRefunds(query);

    return {
      ...pagination(query, result.total),
      items: result.items.map((refund) =>
        this.refundItem(refund, refund.payment),
      ),
    };
  }

  async webhooks(
    query: AdminWebhooksQueryDto,
  ): Promise<AdminWebhooksResponseDto> {
    const result = await this.adminRepository.listWebhooks(query);

    return {
      ...pagination(query, result.total),
      items: result.items.map((event): AdminWebhookItemDto => ({
        deliveryCount: event.deliveryCount,
        eventType: event.eventType,
        id: event.id,
        lastReceivedAt: event.lastReceivedAt.toISOString(),
        processedAt: event.processedAt?.toISOString() ?? null,
        processingError: event.processingError,
        processingAttempts: event.processingAttempts,
        provider: event.provider,
        providerEventId: event.providerEventId,
        receivedAt: event.receivedAt.toISOString(),
        queueJobId: event.queueJobId,
        queuedAt: event.queuedAt?.toISOString() ?? null,
        status: event.status,
      })),
    };
  }

  webhookQueueSnapshot(): Promise<AdminWebhookQueueResponseDto> {
    return this.webhookQueue.snapshot(50);
  }

  async integrity(): Promise<AdminIntegrityResponseDto> {
    const snapshot = await this.adminRepository.integritySnapshot();
    const outboxCounts: Record<string, number> = Object.fromEntries(
      Object.values(OutboxEventStatus).map((status) => [status, 0]),
    );
    for (const count of snapshot.outboxCounts) {
      outboxCounts[count.status] = count._count._all;
    }

    return {
      ledgerTransactions: snapshot.ledgerTransactions.map((transaction) => ({
        balance: transaction.entries.reduce(
          (total, entry) =>
            total +
            (entry.direction === LedgerDirection.DEBIT
              ? entry.amount
              : -entry.amount),
          0,
        ),
        createdAt: transaction.createdAt.toISOString(),
        currency: transaction.currency,
        entries: transaction.entries.map((entry) => ({
          accountCode: entry.account.code,
          accountName: entry.account.name,
          amount: entry.amount,
          currency: entry.currency,
          direction: entry.direction,
          id: entry.id,
        })),
        id: transaction.id,
        outboxEventId: transaction.outboxEventId,
        referenceId: transaction.referenceId,
        referenceType: transaction.referenceType,
        transactionType: transaction.transactionType,
      })),
      outboxCounts,
      outboxEvents: snapshot.outboxEvents.map((event) => ({
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        createdAt: event.createdAt.toISOString(),
        eventKey: event.eventKey,
        eventType: event.eventType,
        id: event.id,
        lastError: event.lastError,
        processedAt: event.processedAt?.toISOString() ?? null,
        processingAttempts: event.processingAttempts,
        publishedAt: event.publishedAt?.toISOString() ?? null,
        publishAttempts: event.publishAttempts,
        queueJobId: event.queueJobId,
        status: event.status,
      })),
      reconciliationIssues: snapshot.issues.map((issue) =>
        this.reconciliationIssue(issue),
      ),
      reconciliationRuns: snapshot.runs.map((run) => ({
        checkedCount: run.checkedCount,
        completedAt: run.completedAt?.toISOString() ?? null,
        errorCount: run.errorCount,
        id: run.id,
        issueCount: run.issueCount,
        passedCount: run.passedCount,
        startedAt: run.startedAt.toISOString(),
        status: run.status,
        windowEnd: run.windowEnd.toISOString(),
        windowStart: run.windowStart.toISOString(),
      })),
    };
  }

  async resolveReconciliationIssue(
    id: string,
    actorId: string,
  ): Promise<AdminReconciliationIssueDto> {
    const issue = await this.adminRepository.resolveReconciliationIssue(
      id,
      actorId,
    );
    if (!issue) {
      throw new NotFoundException({
        code: 'RECONCILIATION_ISSUE_NOT_FOUND',
        message: 'Reconciliation issue not found.',
      });
    }
    return this.reconciliationIssue(issue);
  }

  async auditLogs(
    query: AdminAuditLogsQueryDto,
  ): Promise<AdminAuditLogsResponseDto> {
    const result = await this.adminRepository.listAuditLogs(query);

    return {
      ...pagination(query, result.total),
      items: result.items.map((log): AdminAuditLogItemDto => ({
        action: log.action,
        actorEmail: log.actor?.email ?? null,
        actorId: log.actorId,
        actorType: log.actorType,
        createdAt: log.createdAt.toISOString(),
        id: log.id,
        metadata: toObject(log.metadataJson),
        targetId: log.targetId,
        targetType: log.targetType,
      })),
    };
  }

  private paymentItem(payment: AdminPaymentRecord): AdminPaymentItemDto {
    const succeeded = sumRefunds(payment, [RefundStatus.SUCCEEDED]);
    const reserved = sumRefunds(payment, [
      RefundStatus.PENDING,
      RefundStatus.SUCCEEDED,
    ]);

    return {
      amount: payment.amount,
      createdAt: payment.createdAt.toISOString(),
      currency: payment.currency,
      customerEmail: payment.order.user.email,
      id: payment.id,
      orderId: payment.orderId,
      orderNo: payment.order.orderNo,
      provider: payment.provider,
      providerAttemptCount: payment._count.attempts,
      providerPaymentId: payment.providerPaymentId,
      refundedAmount: succeeded,
      refunds: payment.refunds.map((refund) =>
        this.refundItem(refund, payment),
      ),
      reservedRefundAmount: reserved,
      status: payment.status,
    };
  }

  private paymentDetail(
    payment: AdminPaymentDetailRecord,
  ): AdminPaymentDetailDto {
    return {
      ...this.paymentItem(payment),
      attempts: payment.attempts.map((attempt) => ({
        createdAt: attempt.createdAt.toISOString(),
        errorCode: attempt.errorCode,
        errorMessage: attempt.errorMessage,
        id: attempt.id,
        providerRequestId: attempt.providerRequestId,
        status: attempt.status,
      })),
      providerCheckoutSessionId: payment.providerCheckoutSessionId,
    };
  }

  private refundItem(
    refund: Refund,
    payment: {
      currency: string;
      order: { orderNo: string; user: { email: string } };
    },
  ): AdminRefundItemDto {
    return {
      amount: refund.amount,
      createdAt: refund.createdAt.toISOString(),
      currency: payment.currency,
      customerEmail: payment.order.user.email,
      failureCode: refund.failureCode,
      failureMessage: refund.failureMessage,
      id: refund.id,
      orderNo: payment.order.orderNo,
      paymentId: refund.paymentId,
      providerRefundId: refund.providerRefundId,
      reason: refund.reason,
      status: refund.status,
      updatedAt: refund.updatedAt.toISOString(),
    };
  }

  private reconciliationIssue(
    issue: AdminReconciliationIssueRecord,
  ): AdminReconciliationIssueDto {
    return {
      customerEmail: issue.payment.order.user.email,
      detectedAt: issue.detectedAt.toISOString(),
      id: issue.id,
      issueType: issue.issueType,
      lastSeenAt: issue.lastSeenAt.toISOString(),
      localSnapshot: toObject(issue.localSnapshot),
      orderNo: issue.payment.order.orderNo,
      paymentId: issue.paymentId,
      provider: issue.provider,
      providerSnapshot: toObject(issue.providerSnapshot),
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
      status: issue.status,
    };
  }
}

function pagination(
  query: { page: number; pageSize: number },
  total: number,
): { page: number; pageSize: number; total: number; totalPages: number } {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

function sumRefunds(
  payment: Pick<AdminPaymentRecord, 'refunds'>,
  statuses: RefundStatus[],
): number {
  const accepted = new Set(statuses);

  return payment.refunds.reduce(
    (total, refund) =>
      total + (accepted.has(refund.status) ? refund.amount : 0),
    0,
  );
}

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}
