import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@payflow/database';

import { DatabaseService } from '../database/database.service';
import type {
  AdminAuditLogsQueryDto,
  AdminOrdersQueryDto,
  AdminPaymentsQueryDto,
  AdminRefundsQueryDto,
  AdminWebhooksQueryDto,
} from './dto/admin-query.dto';

const paymentInclude = {
  _count: { select: { attempts: true } },
  order: { include: { user: true } },
  refunds: { orderBy: { createdAt: 'desc' as const } },
} as const;

export type AdminPaymentRecord = Prisma.PaymentGetPayload<{
  include: typeof paymentInclude;
}>;
export type AdminPaymentDetailRecord = Prisma.PaymentGetPayload<{
  include: {
    _count: { select: { attempts: true } };
    attempts: true;
    order: { include: { user: true } };
    refunds: true;
  };
}>;

@Injectable()
export class AdminRepository {
  constructor(private readonly database: DatabaseService) {}

  async dashboard(): Promise<{
    failedPaymentCount: number;
    failedWebhookCount: number;
    orderCount: number;
    refundTotals: Array<{ amount: bigint; currency: string }>;
    successfulPaymentCount: number;
  }> {
    const [
      orderCount,
      successfulPaymentCount,
      failedPaymentCount,
      failedWebhookCount,
      refundTotals,
    ] = await Promise.all([
      this.database.prisma.order.count(),
      this.database.prisma.payment.count({
        where: {
          status: {
            in: [
              PaymentStatus.SUCCEEDED,
              PaymentStatus.PARTIALLY_REFUNDED,
              PaymentStatus.REFUNDED,
            ],
          },
        },
      }),
      this.database.prisma.payment.count({
        where: { status: PaymentStatus.FAILED },
      }),
      this.database.prisma.webhookEvent.count({ where: { status: 'FAILED' } }),
      this.database.prisma.$queryRaw<
        Array<{ amount: bigint; currency: string }>
      >(Prisma.sql`
        SELECT p."currency", SUM(r."amount")::bigint AS "amount"
        FROM "refunds" r
        INNER JOIN "payments" p ON p."id" = r."payment_id"
        WHERE r."status" = 'SUCCEEDED'
        GROUP BY p."currency"
        ORDER BY p."currency" ASC
      `),
    ]);

    return {
      failedPaymentCount,
      failedWebhookCount,
      orderCount,
      refundTotals,
      successfulPaymentCount,
    };
  }

  async listOrders(query: AdminOrdersQueryDto) {
    const where: Prisma.OrderWhereInput = {
      status: query.status,
      ...(query.query
        ? {
            OR: [
              {
                orderNo: {
                  contains: query.query,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                user: {
                  email: {
                    contains: query.query,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.database.prisma.order.findMany({
        where,
        include: {
          _count: { select: { items: true, payments: true } },
          user: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: skip(query),
        take: query.pageSize,
      }),
      this.database.prisma.order.count({ where }),
    ]);

    return { items, total };
  }

  findOrder(id: string) {
    return this.database.prisma.order.findUnique({
      where: { id },
      include: {
        items: { orderBy: { skuSnapshot: 'asc' } },
        payments: {
          include: {
            ...paymentInclude,
            attempts: { orderBy: { createdAt: 'desc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
        user: true,
      },
    });
  }

  async listPayments(query: AdminPaymentsQueryDto) {
    const where: Prisma.PaymentWhereInput = {
      provider: query.provider,
      status: query.status,
      ...(query.query
        ? {
            OR: [
              {
                providerPaymentId: {
                  contains: query.query,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                order: {
                  OR: [
                    {
                      orderNo: {
                        contains: query.query,
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
                    {
                      user: {
                        email: {
                          contains: query.query,
                          mode: Prisma.QueryMode.insensitive,
                        },
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.database.prisma.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: { createdAt: 'desc' },
        skip: skip(query),
        take: query.pageSize,
      }),
      this.database.prisma.payment.count({ where }),
    ]);

    return { items, total };
  }

  findPayment(id: string) {
    return this.database.prisma.payment.findUnique({
      where: { id },
      include: {
        ...paymentInclude,
        attempts: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async listRefunds(query: AdminRefundsQueryDto) {
    const where: Prisma.RefundWhereInput = {
      status: query.status,
      ...(query.query
        ? {
            OR: [
              {
                providerRefundId: {
                  contains: query.query,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                payment: {
                  order: {
                    OR: [
                      {
                        orderNo: {
                          contains: query.query,
                          mode: Prisma.QueryMode.insensitive,
                        },
                      },
                      {
                        user: {
                          email: {
                            contains: query.query,
                            mode: Prisma.QueryMode.insensitive,
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.database.prisma.refund.findMany({
        where,
        include: {
          payment: { include: { order: { include: { user: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: skip(query),
        take: query.pageSize,
      }),
      this.database.prisma.refund.count({ where }),
    ]);

    return { items, total };
  }

  async listWebhooks(query: AdminWebhooksQueryDto) {
    const where: Prisma.WebhookEventWhereInput = {
      eventType: query.eventType,
      status: query.status,
    };
    const [items, total] = await Promise.all([
      this.database.prisma.webhookEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: skip(query),
        take: query.pageSize,
      }),
      this.database.prisma.webhookEvent.count({ where }),
    ]);

    return { items, total };
  }

  async listAuditLogs(query: AdminAuditLogsQueryDto) {
    const where: Prisma.AuditLogWhereInput = { action: query.action };
    const [items, total] = await Promise.all([
      this.database.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: skip(query),
        take: query.pageSize,
      }),
      this.database.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}

function skip(query: { page: number; pageSize: number }): number {
  return (query.page - 1) * query.pageSize;
}
