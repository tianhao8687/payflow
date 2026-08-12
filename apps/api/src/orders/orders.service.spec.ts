import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  type Product,
} from '@payflow/database';

import type { CreateOrderRequestDto } from './dto/create-order-request.dto';
import {
  type OrderDraft,
  type OrderWithItems,
  OrdersRepository,
} from './orders.repository';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  const userId = '03299da2-7263-47c5-8f38-e621bf11af04';
  const product: Product = {
    active: true,
    currency: 'USD',
    id: '369ca219-b504-4fa2-b821-66ed4219fdd2',
    name: 'Server Price Product',
    priceAmount: 3400,
    sku: 'PF-ORDER-001',
    stock: 10,
  };
  let repository: {
    cancelPendingOwned: jest.Mock;
    createFromCart: jest.Mock;
    findOwned: jest.Mock;
    findOwnedById: jest.Mock;
  };
  let service: OrdersService;

  beforeEach(() => {
    repository = {
      cancelPendingOwned: jest.fn(),
      createFromCart: jest.fn(),
      findOwned: jest.fn(),
      findOwnedById: jest.fn(),
    };
    service = new OrdersService(repository as unknown as OrdersRepository);
  });

  it('calculates every amount from the database product and aggregates duplicates', async () => {
    repository.createFromCart.mockImplementation(
      (
        receivedUserId: string,
        orderNo: string,
        cartItems: Array<{ productId: string; quantity: number }>,
        buildDraft: (products: Product[]) => OrderDraft,
      ) => {
        expect(receivedUserId).toBe(userId);
        expect(cartItems).toEqual([{ productId: product.id, quantity: 3 }]);
        return Promise.resolve(
          createOrder(orderNo, receivedUserId, buildDraft([product])),
        );
      },
    );
    const request = {
      items: [
        { productId: product.id, quantity: 1, unitPriceAmount: 1 },
        { productId: product.id, quantity: 2, unitPriceAmount: 1 },
      ],
    } as unknown as CreateOrderRequestDto;

    const result = await service.create(userId, request);

    expect(result.subtotalAmount).toBe(10_200);
    expect(result.totalAmount).toBe(10_200);
    expect(result.items).toEqual([
      expect.objectContaining({
        lineTotalAmount: 10_200,
        quantity: 3,
        unitPriceAmount: 3400,
      }),
    ]);
  });

  it('rejects unavailable products and quantities above stock', async () => {
    repository.createFromCart.mockImplementation(
      (
        _userId: string,
        _orderNo: string,
        _cartItems: unknown,
        buildDraft: (products: Product[]) => OrderDraft,
      ) => Promise.resolve(buildDraft([])),
    );
    await expect(
      service.create(userId, {
        items: [{ productId: product.id, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ status: 422 });

    repository.createFromCart.mockImplementation(
      (
        _userId: string,
        _orderNo: string,
        _cartItems: unknown,
        buildDraft: (products: Product[]) => OrderDraft,
      ) => Promise.resolve(buildDraft([product])),
    );
    await expect(
      service.create(userId, {
        items: [{ productId: product.id, quantity: product.stock + 1 }],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('enforces ownership and the pending-only cancellation transition', async () => {
    repository.findOwnedById.mockResolvedValueOnce(null);
    await expect(service.findById('order-id', userId)).rejects.toMatchObject({
      status: 404,
    });

    const pending = createOrder('PF-TEST', userId, {
      currency: 'USD',
      items: [],
      subtotalAmount: 0,
      totalAmount: 0,
    });
    const cancelled = { ...pending, status: OrderStatus.CANCELLED };
    repository.findOwnedById.mockResolvedValueOnce(pending);
    repository.cancelPendingOwned.mockResolvedValueOnce(cancelled);
    await expect(service.cancel(pending.id, userId)).resolves.toMatchObject({
      status: OrderStatus.CANCELLED,
    });

    const activePaymentOrder: OrderWithItems = {
      ...pending,
      payments: [
        {
          amount: 1000,
          attemptNo: 1,
          checkoutExpiresAt: new Date('2026-08-13T12:00:00.000Z'),
          checkoutUrl: 'https://checkout.stripe.com/c/test',
          createdAt: new Date('2026-08-12T12:01:00.000Z'),
          currency: 'USD',
          id: '1a109d0d-96c5-4cdd-8829-8a4df60ddcb6',
          idempotencyKey: `payment:create:${pending.id}:1`,
          orderId: pending.id,
          provider: PaymentProvider.STRIPE,
          providerCheckoutSessionId: 'cs_test_active',
          providerPaymentId: null,
          status: PaymentStatus.PENDING,
          updatedAt: new Date('2026-08-12T12:01:00.000Z'),
        },
      ],
    };
    repository.cancelPendingOwned.mockClear();
    repository.findOwnedById.mockResolvedValueOnce(activePaymentOrder);
    await expect(service.cancel(pending.id, userId)).rejects.toMatchObject({
      response: { code: 'ORDER_PAYMENT_IN_PROGRESS' },
      status: 409,
    });
    expect(repository.cancelPendingOwned).not.toHaveBeenCalled();

    repository.findOwnedById.mockResolvedValueOnce(cancelled);
    await expect(service.cancel(pending.id, userId)).rejects.toMatchObject({
      status: 409,
    });
  });
});

function createOrder(
  orderNo: string,
  userId: string,
  draft: OrderDraft,
): OrderWithItems {
  return {
    createdAt: new Date('2026-08-12T12:00:00.000Z'),
    currency: draft.currency,
    id: 'a1ba6f2f-2de0-4ed3-952f-c485fb98043c',
    items: draft.items.map((item, index) => ({
      ...item,
      id: `e5ca652c-f276-4ea6-bd64-12345678900${index}`,
      orderId: 'a1ba6f2f-2de0-4ed3-952f-c485fb98043c',
    })),
    orderNo,
    payments: [],
    status: OrderStatus.PENDING_PAYMENT,
    subtotalAmount: draft.subtotalAmount,
    totalAmount: draft.totalAmount,
    userId,
  };
}
