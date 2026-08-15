import {
  PaymentProviderCapability,
  PaymentProviderError,
  ProviderPaymentStatus,
  ProviderRefundStatus,
} from '@payflow/payment-core';

import {
  AlipayProvider,
  type AlipayProviderOptions,
  type AlipaySdkLike,
} from './alipay.provider';

const paymentId = '11111111-1111-4111-8111-111111111111';
const refundId = '22222222-2222-4222-8222-222222222222';
const refundRequestId = '44444444-4444-4444-8444-444444444444';

describe('AlipayProvider', () => {
  it('creates a CNY page payment with the stable merchant reference', async () => {
    const sdk = sdkMock();
    sdk.pageExecute.mockReturnValue(
      'https://openapi-sandbox.dl.alipaydev.com/gateway.do?sign=fake',
    );
    const provider = configuredProvider(sdk);

    await expect(provider.createPayment(createInput())).resolves.toMatchObject({
      amount: 12_345,
      checkoutUrl:
        'https://openapi-sandbox.dl.alipaydev.com/gateway.do?sign=fake',
      currency: 'CNY',
      merchantReference: paymentId,
      providerCheckoutSessionId: null,
      providerPaymentId: null,
      status: ProviderPaymentStatus.PENDING,
    });
    expect(sdk.pageExecute.mock.calls).toHaveLength(1);
    const createCall = sdk.pageExecute.mock.calls[0]!;
    expect(createCall[0]).toBe('alipay.trade.page.pay');
    expect(createCall[1]).toBe('GET');
    expect(createCall[2].bizContent).toMatchObject({
      outTradeNo: paymentId,
      productCode: 'FAST_INSTANT_TRADE_PAY',
      totalAmount: '123.45',
    });
  });

  it('rejects non-CNY and a redirect outside the exact gateway host', async () => {
    const sdk = sdkMock();
    const provider = configuredProvider(sdk);
    await expect(
      provider.createPayment({ ...createInput(), currency: 'USD' }),
    ).rejects.toMatchObject({ code: 'ALIPAY_CURRENCY_UNSUPPORTED' });

    sdk.pageExecute.mockReturnValue(
      'https://evil.example/gateway.do?sign=fake',
    );
    await expect(provider.createPayment(createInput())).rejects.toMatchObject({
      code: 'ALIPAY_CHECKOUT_HOST_INVALID',
    });
  });

  it('fails closed on mixed gateway and incomplete production certificate configuration', () => {
    expect(
      () =>
        new AlipayProvider({
          ...options(),
          gatewayUrl: 'https://openapi.alipay.com/gateway.do',
        }),
    ).toThrow('sandbox gateway');

    expect(
      () =>
        new AlipayProvider({
          ...options(),
          allowProduction: true,
          environment: 'production',
          gatewayUrl: 'https://openapi.alipay.com/gateway.do',
        }),
    ).toThrow('certificate mode');
  });

  it('maps payment query and closes only an unpaid trade', async () => {
    const sdk = sdkMock();
    sdk.exec
      .mockResolvedValueOnce({
        code: '10000',
        msg: 'Success',
        outTradeNo: paymentId,
        totalAmount: '123.45',
        tradeStatus: 'WAIT_BUYER_PAY',
      })
      .mockResolvedValueOnce({
        code: '10000',
        msg: 'Success',
        outTradeNo: paymentId,
        traceId: 'trace-close',
      });
    const provider = configuredProvider(sdk);

    await expect(
      provider.cancelPayment({
        amount: 12_345,
        currency: 'CNY',
        idempotencyKey: 'close-key',
        merchantReference: paymentId,
        providerPaymentId: null,
      }),
    ).resolves.toMatchObject({
      amount: 12_345,
      providerPaymentId: null,
      status: ProviderPaymentStatus.FAILED,
    });
    const closeCall = sdk.exec.mock.calls[1]!;
    expect(closeCall[0]).toBe('alipay.trade.close');
    expect(closeCall[1]?.bizContent).toEqual({ outTradeNo: paymentId });
  });

  it('uses bounded exponential retry for retryable provider failures', async () => {
    const sdk = sdkMock();
    const delays: number[] = [];
    sdk.exec
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({
        code: '10000',
        msg: 'Success',
        outTradeNo: paymentId,
        totalAmount: '123.45',
        tradeStatus: 'WAIT_BUYER_PAY',
      });
    const provider = new AlipayProvider({
      ...options(),
      random: () => 0,
      sdk,
      sleep: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });

    await expect(
      provider.getPaymentByReference({
        amount: 12_345,
        currency: 'CNY',
        merchantReference: paymentId,
        providerCheckoutSessionId: null,
        providerPaymentId: null,
      }),
    ).resolves.toMatchObject({ status: ProviderPaymentStatus.PENDING });
    expect(sdk.exec.mock.calls).toHaveLength(2);
    expect(delays).toEqual([100]);
  });

  it('classifies an exhausted refund transport failure as retryable with unknown outcome', async () => {
    const sdk = sdkMock();
    sdk.exec.mockRejectedValue(new Error('transport failed'));
    const provider = new AlipayProvider({
      ...options(),
      maxRequestAttempts: 1,
      sdk,
    });

    await expect(
      provider.refundPayment({
        amount: 1_000,
        currency: 'CNY',
        idempotencyKey: 'refund-key',
        orderId: '33333333-3333-4333-8333-333333333333',
        paymentId,
        providerPaymentId: '20260815000001',
        refundId,
        refundRequestId,
      }),
    ).rejects.toMatchObject({ outcomeUnknown: true, retryable: true });
  });

  it('keeps fund_change=N pending and confirms it through refund query', async () => {
    const sdk = sdkMock();
    sdk.exec
      .mockResolvedValueOnce({
        code: '10000',
        fundChange: 'N',
        msg: 'Success',
        outTradeNo: paymentId,
        refundFee: '10.00',
        tradeNo: '20260815000001',
      })
      .mockResolvedValueOnce({
        code: '10000',
        msg: 'Success',
        outTradeNo: paymentId,
        refundAmount: '10.00',
        refundStatus: 'REFUND_SUCCESS',
        tradeNo: '20260815000001',
      });
    const provider = configuredProvider(sdk);
    const created = await provider.refundPayment({
      amount: 1_000,
      currency: 'CNY',
      idempotencyKey: 'refund-key',
      orderId: '33333333-3333-4333-8333-333333333333',
      paymentId,
      providerPaymentId: '20260815000001',
      refundId,
      refundRequestId,
    });
    expect(created.status).toBe(ProviderRefundStatus.PENDING);
    expect(created.providerRefundId).toBe(refundId);
    const refundCall = sdk.exec.mock.calls[0]!;
    expect(refundCall[0]).toBe('alipay.trade.refund');
    expect(refundCall[1]?.bizContent).toMatchObject({
      outRequestNo: refundId,
    });

    await expect(
      provider.getRefund({
        amount: 1_000,
        currency: 'CNY',
        merchantReference: paymentId,
        providerPaymentId: '20260815000001',
        providerRefundId: refundId,
        refundId,
      }),
    ).resolves.toMatchObject({ status: ProviderRefundStatus.SUCCEEDED });
  });

  it('verifies and minimizes a successful form notification', async () => {
    const sdk = sdkMock();
    sdk.checkNotifySignV2.mockReturnValue(true);
    const provider = configuredProvider(sdk);
    const form = {
      app_id: 'sandbox-app-id',
      buyer_id: 'must-not-be-persisted',
      buyer_logon_id: 'must-not-be-persisted@example.test',
      gmt_payment: '2026-08-15 20:30:00',
      notify_id: 'notify-1',
      out_trade_no: paymentId,
      seller_id: 'sandbox-seller-id',
      sign: 'fake-signature',
      total_amount: '123.45',
      trade_no: '20260815000001',
      trade_status: 'TRADE_SUCCESS',
    };
    const rawBody = Buffer.from(new URLSearchParams(form).toString());
    const event = await provider.verifyWebhook({
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
      parsedForm: form,
      rawBody,
    });

    expect(event).toMatchObject({
      action: {
        amount: 12_345,
        currency: 'CNY',
        merchantReference: paymentId,
        providerPaymentId: '20260815000001',
        targetStatus: ProviderPaymentStatus.SUCCEEDED,
      },
      paymentAssertion: {
        amount: 12_345,
        currency: 'CNY',
        merchantReference: paymentId,
      },
      provider: 'ALIPAY',
      providerEventId: 'notify-1',
    });
    expect(event.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(event.payload)).not.toContain('buyer');
  });

  it('does not regress a closed trade that contains refund evidence', async () => {
    const sdk = sdkMock();
    sdk.checkNotifySignV2.mockReturnValue(true);
    const provider = configuredProvider(sdk);
    const form = {
      app_id: 'sandbox-app-id',
      notify_id: 'notify-refunded-close',
      out_trade_no: paymentId,
      refund_fee: '10.00',
      seller_id: 'sandbox-seller-id',
      sign: 'fake-signature',
      total_amount: '123.45',
      trade_no: '20260815000001',
      trade_status: 'TRADE_CLOSED',
    };

    const event = await provider.verifyWebhook({
      contentType: 'application/x-www-form-urlencoded',
      parsedForm: form,
      rawBody: Buffer.from(new URLSearchParams(form).toString()),
    });
    expect(event.action).toEqual({
      kind: 'IGNORE',
      reason:
        'Alipay closed trade contains refund evidence and requires refund reconciliation.',
    });
    expect(event.paymentAssertion).toEqual({
      amount: 12_345,
      currency: 'CNY',
      merchantReference: paymentId,
    });
  });

  it('fails closed on bad signatures and merchant identity', async () => {
    const sdk = sdkMock();
    const provider = configuredProvider(sdk);
    const base = {
      app_id: 'sandbox-app-id',
      notify_id: 'notify-1',
      out_trade_no: paymentId,
      seller_id: 'sandbox-seller-id',
      sign: 'fake-signature',
      total_amount: '1.00',
      trade_no: '20260815000001',
      trade_status: 'TRADE_SUCCESS',
    };
    sdk.checkNotifySignV2.mockReturnValue(false);
    await expect(
      provider.verifyWebhook({
        contentType: 'application/x-www-form-urlencoded',
        parsedForm: base,
        rawBody: Buffer.from('fake'),
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });

    sdk.checkNotifySignV2.mockReturnValue(true);
    await expect(
      provider.verifyWebhook({
        contentType: 'application/x-www-form-urlencoded',
        parsedForm: { ...base, seller_id: 'wrong-seller' },
        rawBody: Buffer.from('fake'),
      }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('stays unavailable when explicitly disabled', () => {
    const provider = new AlipayProvider({
      ...options(),
      appId: '',
      enabled: false,
      privateKey: '',
    });
    expect(provider.isConfigured(PaymentProviderCapability.PAYMENT)).toBe(
      false,
    );
  });
});

function configuredProvider(sdk: SdkMock): AlipayProvider {
  return new AlipayProvider({ ...options(), sdk });
}

function options(): AlipayProviderOptions {
  return {
    alipayPublicKey: 'fake-sandbox-public-key',
    appId: 'sandbox-app-id',
    enabled: true,
    environment: 'sandbox',
    gatewayUrl: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
    notifyUrl: 'https://payflow.example/webhooks/alipay',
    now: () => Date.parse('2026-08-15T12:00:00.000Z'),
    privateKey: 'fake-sandbox-private-key',
    returnUrl:
      'https://payflow.example/payments/{paymentId}/result?provider=alipay',
    sellerId: 'sandbox-seller-id',
  };
}

function createInput() {
  return {
    amount: 12_345,
    cancelUrl: 'https://payflow.example/orders/order-id',
    currency: 'CNY',
    idempotencyKey: 'payment:create:alipay:order-id:1',
    lines: [
      {
        name: 'PayFlow CNY Sandbox Item',
        quantity: 1,
        sku: 'PF-CNY-001',
        unitAmount: 12_345,
      },
    ],
    merchantReference: paymentId,
    orderId: '33333333-3333-4333-8333-333333333333',
    paymentId,
    successUrl: 'https://payflow.example/payments/result',
  };
}

type SdkMock = {
  checkNotifySignV2: jest.MockedFunction<AlipaySdkLike['checkNotifySignV2']>;
  exec: jest.MockedFunction<AlipaySdkLike['exec']>;
  pageExecute: jest.MockedFunction<AlipaySdkLike['pageExecute']>;
};

function sdkMock(): SdkMock {
  return {
    checkNotifySignV2: jest.fn<
      ReturnType<AlipaySdkLike['checkNotifySignV2']>,
      Parameters<AlipaySdkLike['checkNotifySignV2']>
    >(),
    exec: jest.fn<
      ReturnType<AlipaySdkLike['exec']>,
      Parameters<AlipaySdkLike['exec']>
    >(),
    pageExecute: jest.fn<
      ReturnType<AlipaySdkLike['pageExecute']>,
      Parameters<AlipaySdkLike['pageExecute']>
    >(),
  };
}
