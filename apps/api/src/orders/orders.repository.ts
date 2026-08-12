import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, type Product } from '@payflow/database';

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
  include: { items: true };
}>;

const includeItems = {
  items: { orderBy: { skuSnapshot: 'asc' as const } },
} as const;

@Injectable()
export class OrdersRepository {
  constructor(private readonly database: DatabaseService) {}

  createFromCart(
    userId: string,
    orderNo: string,
    cartItems: NormalizedCartItem[],
    buildDraft: (products: Product[]) => OrderDraft,
  ): Promise<OrderWithItems> {
    return this.database.prisma.$transaction(
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
    return this.database.prisma.$transaction(
      async (transaction) => {
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
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
