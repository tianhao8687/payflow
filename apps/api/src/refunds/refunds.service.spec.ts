import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  RefundStatus,
} from '@payflow/database';
import {
  type PaymentProvider as PaymentProviderAdapter,
  PaymentProviderError,
  ProviderRefundStatus,
} from '@payflow/payment-core';

import {
  type RefundReservation,
  type RefundWithPayment,
  RefundsRepository,
} from './refunds.repository';
import { RefundsService } from './refunds.service';

describe('RefundsService', () => {
  let repository: {
    applyProviderResult: jest.Mock;
    beginProviderAttempt: jest.Mock;
    findPaymentProvider: jest.Mock;
    recordProviderFailure: jest.Mock;
    reserve: jest.Mock;
  };
  let provider: {
    getRefund: jest.Mock;
    isConfigured: jest.Mock;
    name: string;
    refundPayment: jest.Mock;
  };
  let service: RefundsService;

  beforeEach(() => {
    repository = {
      applyProviderResult: jest.fn(),
      beginProviderAttempt: jest.fn().mockResolvedValue(true),
      recordProviderFailure: jest.fn(),
      reserve: jest.fn(),
      findPaymentProvider: jest.fn().mockResolvedValue(PaymentProvider.STRIPE),
    };
    provider = {
      getRefund: jest.fn(),
      isConfigured: jest.fn().mockReturnValue(true),
      name: 'STRIPE',
      refundPayment: jest.fn(),
    };
    service = new RefundsService(
      repository as unknown as RefundsRepository,
      provider as unknown as PaymentProviderAdapter,
    );
  });

  it('applies a verified provider result with the same reserved identifiers', async () => {
    const pending = refundFixture();
    repository.reserve.mockResolvedValue(reservation(pending));
    provider.refundPayment.mockResolvedValue({
      amount: pending.amount,
      currency: 'USD',
      failureCode: null,
      failureMessage: null,
      providerPaymentId: pending.payment.providerPaymentId,
      providerRefundId: 're_test_service',
      providerRequestId: 'req_test_service',
      status: ProviderRefundStatus.SUCCEEDED,
    });
    const succeeded = refundFixture({
      providerRefundId: 're_test_service',
      status: RefundStatus.SUCCEEDED,
    });
    repository.applyProviderResult.mockResolvedValue({
      changed: true,
      refund: succeeded,
    });

    await expect(
      service.create('payment-id', 'admin-id', {
        amount: 1200,
        reason: 'Customer returned one item.',
        refundRequestId: '44444444-4444-4444-8444-444444444444',
      }),
    ).resolves.toMatchObject({
      refund: {
        id: pending.id,
        providerRefundId: 're_test_service',
        status: RefundStatus.SUCCEEDED,
      },
      reused: false,
    });
    expect(provider.refundPayment).toHaveBeenCalledWith({
      amount: 1200,
      currency: 'USD',
      idempotencyKey: pending.idempotencyKey,
      orderId: pending.payment.orderId,
      paymentId: pending.paymentId,
      providerPaymentId: pending.payment.providerPaymentId,
      refundId: pending.id,
      refundRequestId: pending.refundRequestId,
    });
    expect(repository.applyProviderResult).toHaveBeenCalledWith(
      pending.id,
      'admin-id',
      expect.objectContaining({
        providerRefundId: 're_test_service',
        providerRequestId: 'req_test_service',
        status: RefundStatus.SUCCEEDED,
      }),
    );
  });

  it('returns an existing terminal refund without another Stripe call', async () => {
    const succeeded = refundFixture({
      providerRefundId: 're_test_existing',
      status: RefundStatus.SUCCEEDED,
    });
    repository.reserve.mockResolvedValue(reservation(succeeded, false));

    await expect(
      service.create('payment-id', 'admin-id', {
        amount: 1200,
        reason: 'Customer returned one item.',
        refundRequestId: succeeded.refundRequestId,
      }),
    ).resolves.toMatchObject({
      refund: { id: succeeded.id, status: RefundStatus.SUCCEEDED },
      reused: true,
    });
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it('queries a reused pending refund with the original provider reference before retrying', async () => {
    const pending = refundFixture();
    const succeeded = refundFixture({
      providerRefundId: pending.id,
      status: RefundStatus.SUCCEEDED,
    });
    repository.reserve.mockResolvedValue(reservation(pending, false));
    provider.getRefund.mockResolvedValue({
      amount: pending.amount,
      currency: pending.payment.currency,
      failureCode: null,
      failureMessage: null,
      providerPaymentId: pending.payment.providerPaymentId,
      providerRefundId: pending.id,
      providerRequestId: 'query-request',
      status: ProviderRefundStatus.SUCCEEDED,
    });
    repository.applyProviderResult.mockResolvedValue({
      changed: true,
      refund: succeeded,
    });

    await expect(
      service.create('payment-id', 'admin-id', {
        amount: pending.amount,
        reason: pending.reason,
        refundRequestId: pending.refundRequestId,
      }),
    ).resolves.toMatchObject({
      refund: { id: pending.id, status: RefundStatus.SUCCEEDED },
      reused: true,
    });
    expect(provider.getRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantReference: pending.paymentId,
        refundId: pending.id,
      }),
    );
    expect(repository.beginProviderAttempt).not.toHaveBeenCalled();
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it('records deterministic Stripe rejection as a terminal failed refund', async () => {
    const pending = refundFixture();
    repository.reserve.mockResolvedValue(reservation(pending));
    provider.refundPayment.mockRejectedValue(
      new PaymentProviderError(
        'STRIPE',
        'REFUND_PAYMENT',
        'charge_already_refunded',
        'Nothing remains refundable.',
        'req_rejected',
        false,
      ),
    );
    repository.recordProviderFailure.mockResolvedValue({
      changed: true,
      refund: refundFixture({ status: RefundStatus.FAILED }),
    });

    await expect(
      service.create('payment-id', 'admin-id', {
        amount: 1200,
        reason: 'Customer returned one item.',
        refundRequestId: pending.refundRequestId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'REFUND_PROVIDER_ERROR' },
      status: 502,
    });
    expect(repository.recordProviderFailure).toHaveBeenCalledWith(
      pending.id,
      'admin-id',
      'charge_already_refunded',
      'Nothing remains refundable.',
      'req_rejected',
    );
  });

  it('leaves an unknown Stripe outcome pending for same-key retry', async () => {
    const pending = refundFixture();
    repository.reserve.mockResolvedValue(reservation(pending));
    provider.refundPayment.mockRejectedValue(
      new PaymentProviderError(
        'STRIPE',
        'REFUND_PAYMENT',
        'StripeConnectionError',
        'The connection closed without a response.',
        null,
        true,
      ),
    );

    await expect(
      service.create('payment-id', 'admin-id', {
        amount: 1200,
        reason: 'Customer returned one item.',
        refundRequestId: pending.refundRequestId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'REFUND_PROVIDER_OUTCOME_UNKNOWN' },
      status: 502,
    });
    expect(repository.recordProviderFailure).not.toHaveBeenCalled();
  });

  it('fails closed before reserving when Stripe test mode is absent', async () => {
    provider.isConfigured.mockReturnValue(false);

    await expect(
      service.create('payment-id', 'admin-id', {
        amount: 1200,
        reason: 'Customer returned one item.',
        refundRequestId: '44444444-4444-4444-8444-444444444444',
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(repository.reserve).not.toHaveBeenCalled();
  });
});

function reservation(
  refund: RefundWithPayment,
  created = true,
): RefundReservation {
  return { created, kind: 'RESERVED', refund };
}

function refundFixture(
  overrides: Partial<RefundWithPayment> = {},
): RefundWithPayment {
  const now = new Date('2026-08-13T00:00:00.000Z');

  return {
    amount: 1200,
    createdAt: now,
    failureCode: null,
    failureMessage: null,
    id: '33333333-3333-4333-8333-333333333333',
    idempotencyKey:
      'refund:create:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444',
    lastProviderAttemptAt: null,
    payment: {
      amount: 3600,
      attemptNo: 1,
      checkoutExpiresAt: null,
      checkoutUrl: null,
      createdAt: now,
      currency: 'USD',
      id: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: 'payment:create:order-id:1',
      order: {
        createdAt: now,
        currency: 'USD',
        id: '22222222-2222-4222-8222-222222222222',
        orderNo: 'PF-STAGE-5-UNIT',
        status: OrderStatus.PAID,
        subtotalAmount: 3600,
        totalAmount: 3600,
        userId: '55555555-5555-4555-8555-555555555555',
      },
      orderId: '22222222-2222-4222-8222-222222222222',
      provider: PaymentProvider.STRIPE,
      providerCheckoutSessionId: 'cs_test_service',
      providerPaymentId: 'pi_test_service',
      status: PaymentStatus.SUCCEEDED,
      updatedAt: now,
    },
    paymentId: '11111111-1111-4111-8111-111111111111',
    providerRefundId: null,
    providerRequestId: null,
    reason: 'Customer returned one item.',
    refundRequestId: '44444444-4444-4444-8444-444444444444',
    status: RefundStatus.PENDING,
    updatedAt: now,
    ...overrides,
  };
}
