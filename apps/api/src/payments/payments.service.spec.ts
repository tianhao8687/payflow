import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentProvider, PaymentStatus } from '@payflow/database';

import type { ApiEnvironment } from '../config/environment';
import {
  type PaymentReservation,
  type PaymentWithCount,
  PaymentsRepository,
} from './payments.repository';
import { PaymentsService } from './payments.service';
import {
  StripeCheckoutGateway,
  StripeCheckoutGatewayError,
} from './stripe-checkout.gateway';

describe('PaymentsService', () => {
  let repository: {
    completeCheckoutSession: jest.Mock;
    failProviderAttempt: jest.Mock;
    findOwnedById: jest.Mock;
    reserveStripePayment: jest.Mock;
    startProviderAttempt: jest.Mock;
  };
  let stripe: {
    createCheckoutSession: jest.Mock;
    isConfigured: jest.Mock;
  };
  let service: PaymentsService;

  beforeEach(() => {
    repository = {
      completeCheckoutSession: jest.fn(),
      failProviderAttempt: jest.fn(),
      findOwnedById: jest.fn(),
      reserveStripePayment: jest.fn(),
      startProviderAttempt: jest.fn(),
    };
    stripe = {
      createCheckoutSession: jest.fn(),
      isConfigured: jest.fn().mockReturnValue(true),
    };
    const config = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    } as unknown as ConfigService<ApiEnvironment, true>;
    service = new PaymentsService(
      config,
      repository as unknown as PaymentsRepository,
      stripe as unknown as StripeCheckoutGateway,
    );
  });

  it('creates Stripe Checkout from immutable order snapshots and persists PENDING', async () => {
    const reservation = createReservation();
    const reservedPayment = requireReservedPayment(reservation);
    const expiresAt = new Date('2026-08-13T12:00:00.000Z');
    repository.reserveStripePayment.mockResolvedValue(reservation);
    repository.startProviderAttempt.mockResolvedValue({ id: 'attempt-id' });
    stripe.createCheckoutSession.mockResolvedValue({
      amountTotal: 3998,
      currency: 'USD',
      expiresAt,
      paymentIntentId: null,
      requestId: 'req_stage_3',
      sessionId: 'cs_test_stage_3',
      url: 'https://checkout.stripe.test/c/payflow',
    });
    const completed = {
      ...reservedPayment,
      _count: { attempts: 1 },
      checkoutExpiresAt: expiresAt,
      checkoutUrl: 'https://checkout.stripe.test/c/payflow',
      providerCheckoutSessionId: 'cs_test_stage_3',
      status: PaymentStatus.PENDING,
    };
    repository.completeCheckoutSession.mockResolvedValue(completed);

    await expect(
      service.createCheckoutSession('user-id', { orderId: 'order-id' }),
    ).resolves.toMatchObject({
      checkoutUrl: 'https://checkout.stripe.test/c/payflow',
      payment: { amount: 3998, status: PaymentStatus.PENDING },
      reused: false,
    });
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3998,
        currency: 'USD',
        idempotencyKey: 'payment:create:order-id:1',
        lines: [
          {
            name: 'Snapshot Product',
            quantity: 2,
            sku: 'PF-SNAPSHOT',
            unitAmount: 1999,
          },
        ],
        orderId: 'order-id',
        paymentId: 'payment-id',
      }),
    );
  });

  it('returns an existing hosted session without another provider call', async () => {
    const reservation = createReservation();
    const reservedPayment = requireReservedPayment(reservation);
    reservation.created = false;
    reservation.payment = {
      ...reservedPayment,
      checkoutExpiresAt: new Date('2026-08-13T12:00:00.000Z'),
      checkoutUrl: 'https://checkout.stripe.test/c/reused',
      providerCheckoutSessionId: 'cs_test_reused',
      status: PaymentStatus.PENDING,
    };
    repository.reserveStripePayment.mockResolvedValue(reservation);

    await expect(
      service.createCheckoutSession('user-id', { orderId: 'order-id' }),
    ).resolves.toMatchObject({
      checkoutUrl: 'https://checkout.stripe.test/c/reused',
      reused: true,
    });
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('records provider failures while preserving the stable retry key', async () => {
    repository.reserveStripePayment.mockResolvedValue(createReservation());
    repository.startProviderAttempt.mockResolvedValue({ id: 'attempt-id' });
    stripe.createCheckoutSession.mockRejectedValue(
      new StripeCheckoutGatewayError(
        'api_connection_error',
        'Connection failed safely.',
        'req_failed',
      ),
    );

    await expect(
      service.createCheckoutSession('user-id', { orderId: 'order-id' }),
    ).rejects.toMatchObject({ status: 502 });
    expect(repository.failProviderAttempt).toHaveBeenCalledWith(
      'attempt-id',
      'api_connection_error',
      'Connection failed safely.',
      'req_failed',
    );
  });

  it('fails closed when Stripe test mode is not configured', async () => {
    stripe.isConfigured.mockReturnValue(false);

    await expect(
      service.createCheckoutSession('user-id', { orderId: 'order-id' }),
    ).rejects.toMatchObject({ status: 503 });
    expect(repository.reserveStripePayment).not.toHaveBeenCalled();
  });
});

function createReservation(): PaymentReservation {
  const now = new Date('2026-08-12T12:00:00.000Z');
  const payment: PaymentWithCount = {
    _count: { attempts: 0 },
    amount: 3998,
    attemptNo: 1,
    checkoutExpiresAt: null,
    checkoutUrl: null,
    createdAt: now,
    currency: 'USD',
    id: 'payment-id',
    idempotencyKey: 'payment:create:order-id:1',
    orderId: 'order-id',
    provider: PaymentProvider.STRIPE,
    providerCheckoutSessionId: null,
    providerPaymentId: null,
    refunds: [],
    status: PaymentStatus.CREATED,
    updatedAt: now,
  };

  return {
    created: true,
    order: {
      createdAt: now,
      currency: 'USD',
      id: 'order-id',
      items: [
        {
          id: 'item-id',
          lineTotalAmount: 3998,
          nameSnapshot: 'Snapshot Product',
          orderId: 'order-id',
          productId: 'product-id',
          quantity: 2,
          skuSnapshot: 'PF-SNAPSHOT',
          unitPriceAmount: 1999,
        },
      ],
      orderNo: 'PF-STAGE-3',
      status: OrderStatus.PENDING_PAYMENT,
      subtotalAmount: 3998,
      totalAmount: 3998,
      userId: 'user-id',
    },
    payment,
  };
}

function requireReservedPayment(
  reservation: PaymentReservation,
): PaymentWithCount {
  if (!reservation.payment) {
    throw new Error('Test fixture must include a reserved payment.');
  }

  return reservation.payment;
}
