import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, type Product } from '@payflow/database';

import { CreateOrderRequestDto } from './dto/create-order-request.dto';
import { OrderListResponseDto } from './dto/order-list-response.dto';
import {
  OrderItemResponseDto,
  OrderPaymentSummaryResponseDto,
  OrderResponseDto,
} from './dto/order-response.dto';
import { assertOrderTransition } from './order-state-machine';
import {
  type NormalizedCartItem,
  type OrderDraft,
  type OrderWithItems,
  OrdersRepository,
} from './orders.repository';

const MAX_DATABASE_INTEGER = 2_147_483_647;
const MAX_QUANTITY_PER_PRODUCT = 99;

@Injectable()
export class OrdersService {
  constructor(private readonly ordersRepository: OrdersRepository) {}

  async create(
    userId: string,
    request: CreateOrderRequestDto,
  ): Promise<OrderResponseDto> {
    const cartItems = this.normalizeCart(request);
    const order = await this.ordersRepository.createFromCart(
      userId,
      this.createOrderNumber(),
      cartItems,
      (products) => this.buildDraft(cartItems, products),
    );

    return this.toResponse(order);
  }

  async list(userId: string): Promise<OrderListResponseDto> {
    const orders = await this.ordersRepository.findOwned(userId);

    return {
      count: orders.length,
      items: orders.map((order) => this.toResponse(order)),
    };
  }

  async findById(id: string, userId: string): Promise<OrderResponseDto> {
    const order = await this.findOwnedOrder(id, userId);

    return this.toResponse(order);
  }

  async cancel(id: string, userId: string): Promise<OrderResponseDto> {
    const order = await this.findOwnedOrder(id, userId);

    if (
      order.payments.some((payment) => payment.status !== PaymentStatus.FAILED)
    ) {
      throw new ConflictException({
        code: 'ORDER_PAYMENT_IN_PROGRESS',
        message:
          'An active payment attempt prevents cancellation of this order.',
      });
    }

    try {
      assertOrderTransition(order.status, OrderStatus.CANCELLED);
    } catch {
      throw new ConflictException({
        code: 'ORDER_TRANSITION_INVALID',
        details: { from: order.status, to: OrderStatus.CANCELLED },
        message: `Order in ${order.status} cannot be cancelled.`,
      });
    }

    const cancelled = await this.ordersRepository.cancelPendingOwned(
      id,
      userId,
    );

    if (!cancelled) {
      throw new ConflictException({
        code: 'ORDER_STATE_CHANGED',
        message: 'The order state changed before cancellation completed.',
      });
    }

    return this.toResponse(cancelled);
  }

  private normalizeCart(request: CreateOrderRequestDto): NormalizedCartItem[] {
    const quantities = new Map<string, number>();

    for (const item of request.items) {
      const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;

      if (quantity > MAX_QUANTITY_PER_PRODUCT) {
        throw new BadRequestException({
          code: 'ORDER_QUANTITY_INVALID',
          details: { productId: item.productId },
          message: `A product quantity cannot exceed ${MAX_QUANTITY_PER_PRODUCT}.`,
        });
      }

      quantities.set(item.productId, quantity);
    }

    return Array.from(quantities, ([productId, quantity]) => ({
      productId,
      quantity,
    }));
  }

  private buildDraft(
    cartItems: NormalizedCartItem[],
    products: Product[],
  ): OrderDraft {
    const productsById = new Map(
      products.map((product) => [product.id, product]),
    );
    const unavailableProductIds = cartItems
      .filter((item) => !productsById.get(item.productId)?.active)
      .map((item) => item.productId);

    if (unavailableProductIds.length > 0) {
      throw new UnprocessableEntityException({
        code: 'ORDER_PRODUCT_UNAVAILABLE',
        details: { productIds: unavailableProductIds },
        message: 'One or more products are missing or inactive.',
      });
    }

    const currency = productsById.get(cartItems[0].productId)!.currency;
    const items = cartItems.map((cartItem) => {
      const product = productsById.get(cartItem.productId)!;

      if (product.currency !== currency) {
        throw new UnprocessableEntityException({
          code: 'ORDER_MIXED_CURRENCY',
          message: 'All products in an order must use the same currency.',
        });
      }

      if (cartItem.quantity > product.stock) {
        throw new ConflictException({
          code: 'ORDER_INSUFFICIENT_STOCK',
          details: {
            available: product.stock,
            productId: product.id,
            requested: cartItem.quantity,
          },
          message: `${product.name} does not have enough stock.`,
        });
      }

      const lineTotalAmount = product.priceAmount * cartItem.quantity;
      this.assertDatabaseAmount(lineTotalAmount);

      return {
        lineTotalAmount,
        nameSnapshot: product.name,
        productId: product.id,
        quantity: cartItem.quantity,
        skuSnapshot: product.sku,
        unitPriceAmount: product.priceAmount,
      };
    });
    const subtotalAmount = items.reduce(
      (total, item) => total + item.lineTotalAmount,
      0,
    );
    this.assertDatabaseAmount(subtotalAmount);

    return {
      currency,
      items,
      subtotalAmount,
      totalAmount: subtotalAmount,
    };
  }

  private assertDatabaseAmount(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount > MAX_DATABASE_INTEGER) {
      throw new UnprocessableEntityException({
        code: 'ORDER_AMOUNT_TOO_LARGE',
        message: 'The calculated order amount exceeds the supported range.',
      });
    }
  }

  private async findOwnedOrder(
    id: string,
    userId: string,
  ): Promise<OrderWithItems> {
    const order = await this.ordersRepository.findOwnedById(id, userId);

    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found.',
      });
    }

    return order;
  }

  private createOrderNumber(): string {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const suffix = randomUUID().slice(0, 8).toUpperCase();

    return `PF-${date}-${suffix}`;
  }

  private toResponse(order: OrderWithItems): OrderResponseDto {
    return {
      createdAt: order.createdAt.toISOString(),
      currency: order.currency,
      id: order.id,
      items: order.items.map((item): OrderItemResponseDto => ({
        id: item.id,
        lineTotalAmount: item.lineTotalAmount,
        nameSnapshot: item.nameSnapshot,
        productId: item.productId,
        quantity: item.quantity,
        skuSnapshot: item.skuSnapshot,
        unitPriceAmount: item.unitPriceAmount,
      })),
      orderNo: order.orderNo,
      payments: order.payments.map(
        (payment): OrderPaymentSummaryResponseDto => ({
          amount: payment.amount,
          createdAt: payment.createdAt.toISOString(),
          currency: payment.currency,
          id: payment.id,
          provider: payment.provider,
          refunds: payment.refunds.map((refund) => ({
            amount: refund.amount,
            createdAt: refund.createdAt.toISOString(),
            id: refund.id,
            status: refund.status,
            updatedAt: refund.updatedAt.toISOString(),
          })),
          status: payment.status,
        }),
      ),
      status: order.status,
      subtotalAmount: order.subtotalAmount,
      totalAmount: order.totalAmount,
      userId: order.userId,
    };
  }
}
