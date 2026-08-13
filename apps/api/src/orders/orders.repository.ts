import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  isTransactionWriteConflict,
  type Product,
} from '@payflow/database';

import { DatabaseService } from '../database/database.service';

export interface NormalizedCartItem {
  productId: string;
  quantity: number;
}

export interface OrderDraft {
  currency: string;
  items: Array<{
    lineTotalAmount: number;
    nameSnapshot: string;
    productId: string;
    quantity: number;
    skuSnapshot: string;
    unitPriceAmount: number;
  }>;
  subtotalAmount: number;
  totalAmount: number;
}

export type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: true; payments: { include: { refunds: true } } };
}>;

const includeItems = {
  items: { orderBy: { skuSnapshot: 'asc' as const } },
  payments: {
    include: { refunds: { orderBy: { createdAt: 'desc' as const } } },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

@Injectable()
export class OrdersRepository {
  constructor(private readonly database: DatabaseService) {}

  async createFromCart(
    userId: string,
    orderNo: string,
    cartItems: NormalizedCartItem[],
    buildDraft: (products: Product[]) => OrderDraft,
  ): Promise<OrderWithItems> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.database.prisma.$transaction(
          async (transaction) => {
            const products = await transaction.product.findMany({
              where: {
                id: { in: cartItems.map((item) => item.productId) },
              },
            });
            const draft = buildDraft(products);

            return transaction.order.create({
              data: {
                currency: draft.currency,
                items: { create: draft.items },
                orderNo,
                status: OrderStatus.PENDING_PAYMENT,
                subtotalAmount: draft.subtotalAmount,
                totalAmount: draft.totalAmount,
                userId,
              },
              include: includeItems,
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error: unknown) {
        if (isTransactionWriteConflict(error) && attempt < 4) {
          continue;
        }

        throw error;
      }
    }

    throw new Error('Order creation retry limit was exhausted.');
  }

  findOwnedById(id: string, userId: string): Promise<OrderWithItems | null> {
    return this.database.prisma.order.findFirst({
      where: { id, userId },
      include: includeItems,
    });
  }

  findOwned(userId: string): Promise<OrderWithItems[]> {
    return this.database.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: includeItems,
    });
  }

  async cancelPendingOwned(
    id: string,
    userId: string,
  ): Promise<OrderWithItems | null> {
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        return await this.database.prisma.$transaction(
          async (transaction) => {
            await transaction.$queryRaw(
              Prisma.sql`SELECT 1::integer AS acquired
                FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`,
            );

            const current = await transaction.order.findFirst({
              where: { id, userId },
              select: {
                status: true,
                payments: {
                  where: { status: { not: PaymentStatus.FAILED } },
                  select: { id: true },
                  take: 1,
                },
              },
            });

            if (
              !current ||
              current.status !== OrderStatus.PENDING_PAYMENT ||
              current.payments.length > 0
            ) {
              return null;
            }

            const update = await transaction.order.updateMany({
              where: { id, status: OrderStatus.PENDING_PAYMENT, userId },
              data: { status: OrderStatus.CANCELLED },
            });

            if (update.count !== 1) {
              return null;
            }

            return transaction.order.findFirst({
              where: { id, userId },
              include: includeItems,
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
      } catch (error: unknown) {
        if (isTransactionWriteConflict(error) && retry < 2) {
          continue;
        }

        throw error;
      }
    }

    throw new Error('Order cancellation retry limit was exhausted.');
  }
}
