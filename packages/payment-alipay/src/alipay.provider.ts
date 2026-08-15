import { createHash } from 'node:crypto';

import {
  type CancelPaymentInput,
  type CancelPaymentResult,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type GetPaymentInput,
  type GetRefundInput,
  type GetRefundResult,
  type PaymentProvider,
  type PaymentProviderCapability,
  PaymentProviderError,
  type PaymentProviderOperation,
  type ProviderPayment,
  ProviderPaymentStatus,
  ProviderRefundStatus,
  type RefundPaymentInput,
  type RefundPaymentResult,
  type VerifiedWebhookEvent,
  type VerifyWebhookInput,
} from '@payflow/payment-core';
import {
  AlipayRequestError,
  AlipaySdk,
  type AlipaySdkCommonResult,
} from 'alipay-sdk';

import {
  alipayAmountToMinorUnits,
  minorUnitsToAlipayAmount,
} from './alipay-money';

const CNY = 'CNY';
const ALIPAY_TIMEOUT_EXPRESS = '30m';
const ALIPAY_CHECKOUT_TTL_MS = 30 * 60 * 1_000;

export interface AlipaySdkLike {
  checkNotifySignV2: (postData: unknown) => boolean;
  exec: (
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<AlipaySdkCommonResult>;
  pageExecute: (
    method: string,
    httpMethod: 'GET' | 'POST',
    params: Record<string, unknown>,
  ) => string;
}

export interface AlipayProviderOptions {
  allowProduction?: boolean;
  alipayPublicCertContent?: string;
  alipayPublicKey?: string;
  alipayRootCertContent?: string;
  appCertContent?: string;
  appId: string;
  enabled: boolean;
  environment: 'production' | 'sandbox';
  gatewayUrl: string;
  keyType?: 'PKCS1' | 'PKCS8';
  maxRequestAttempts?: number;
  notifyUrl: string;
  now?: () => number;
  privateKey: string;
  returnUrl: string;
  random?: () => number;
  sdk?: AlipaySdkLike;
  sellerId: string;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

export class AlipayProvider implements PaymentProvider {
  readonly name = 'ALIPAY';
  private readonly appId: string;
  private readonly enabled: boolean;
  private readonly gatewayHost: string;
  private readonly notifyUrl: string;
  private readonly now: () => number;
  private readonly maxRequestAttempts: number;
  private readonly random: () => number;
  private readonly returnUrl: string;
  private readonly sdk: AlipaySdkLike | null;
  private readonly sellerId: string;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: AlipayProviderOptions) {
    this.enabled = options.enabled;
    this.appId = options.appId.trim();
    this.sellerId = options.sellerId.trim();
    this.notifyUrl = options.notifyUrl.trim();
    this.returnUrl = options.returnUrl.trim();
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? delay;
    this.maxRequestAttempts = Math.min(
      Math.max(options.maxRequestAttempts ?? 3, 1),
      5,
    );

    if (!options.enabled) {
      this.gatewayHost = '';
      this.sdk = null;
      return;
    }

    const gateway = validateOptions(options);
    this.gatewayHost = gateway.host;
    this.sdk =
      options.sdk ??
      new AlipaySdk({
        alipayPublicCertContent: options.alipayPublicCertContent || undefined,
        alipayPublicKey: options.alipayPublicKey || undefined,
        alipayRootCertContent: options.alipayRootCertContent || undefined,
        appCertContent: options.appCertContent || undefined,
        appId: this.appId,
        gateway: gateway.toString(),
        keyType: options.keyType ?? 'PKCS8',
        privateKey: options.privateKey,
        signType: 'RSA2',
        timeout: options.timeoutMs ?? 20_000,
      });
  }

  isConfigured(capability: PaymentProviderCapability): boolean {
    void capability;
    return this.enabled && this.sdk !== null;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const sdk = this.requireSdk('CREATE_PAYMENT');
    assertCny(input.currency, 'CREATE_PAYMENT');
    assertMerchantReference(input.merchantReference, 'CREATE_PAYMENT');
    const checkoutUrl = await Promise.resolve(
      sdk.pageExecute('alipay.trade.page.pay', 'GET', {
        bizContent: {
          outTradeNo: input.merchantReference,
          productCode: 'FAST_INSTANT_TRADE_PAY',
          subject: paymentSubject(input),
          timeoutExpress: ALIPAY_TIMEOUT_EXPRESS,
          totalAmount: minorUnitsToAlipayAmount(input.amount),
        },
        notifyUrl: this.notifyUrl,
        returnUrl: paymentReturnUrl(this.returnUrl, input.paymentId),
      }),
    );
    const parsed = parseUrl(
      checkoutUrl,
      'Alipay returned an invalid page URL.',
    );
    if (parsed.host !== this.gatewayHost || parsed.protocol !== 'https:') {
      throw new PaymentProviderError(
        this.name,
        'CREATE_PAYMENT',
        'ALIPAY_CHECKOUT_HOST_INVALID',
        'Alipay returned a checkout URL outside the configured gateway.',
      );
    }

    return {
      amount: input.amount,
      checkoutExpiresAt: new Date(this.now() + ALIPAY_CHECKOUT_TTL_MS),
      checkoutUrl,
      currency: CNY,
      merchantReference: input.merchantReference,
      providerCheckoutSessionId: null,
      providerPaymentId: null,
      providerRequestId: null,
      status: ProviderPaymentStatus.PENDING,
    };
  }

  async getPayment(reference: string): Promise<ProviderPayment> {
    assertMerchantReference(reference, 'GET_PAYMENT');
    return this.queryPayment({
      merchantReference: reference,
      providerPaymentId: null,
    });
  }

  getPaymentByReference(input: GetPaymentInput): Promise<ProviderPayment> {
    assertCny(input.currency, 'GET_PAYMENT');
    assertMerchantReference(input.merchantReference, 'GET_PAYMENT');
    return this.queryPayment({
      fallbackAmount: input.amount,
      merchantReference: input.merchantReference,
      providerPaymentId: input.providerPaymentId,
    });
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentResult> {
    if (!input.merchantReference || input.amount === undefined) {
      throw new PaymentProviderError(
        this.name,
        'CANCEL_PAYMENT',
        'ALIPAY_PAYMENT_REFERENCE_MISSING',
        'Alipay close requires the merchant payment reference and amount.',
      );
    }
    assertCny(input.currency ?? '', 'CANCEL_PAYMENT');
    const current = await this.getPaymentByReference({
      amount: input.amount,
      currency: input.currency!,
      merchantReference: input.merchantReference,
      providerCheckoutSessionId: null,
      providerPaymentId: input.providerPaymentId,
    });
    if (current.status === ProviderPaymentStatus.SUCCEEDED) {
      return current;
    }
    if (current.status !== ProviderPaymentStatus.PENDING) {
      return current;
    }

    let result: AlipaySdkCommonResult;
    try {
      result = await this.execute(
        'alipay.trade.close',
        {
          outTradeNo: input.merchantReference,
          ...(input.providerPaymentId
            ? { tradeNo: input.providerPaymentId }
            : {}),
        },
        'CANCEL_PAYMENT',
        true,
      );
    } catch (error: unknown) {
      if (
        error instanceof PaymentProviderError &&
        error.code === 'ACQ.TRADE_NOT_EXIST'
      ) {
        return { ...current, status: ProviderPaymentStatus.FAILED };
      }
      throw error;
    }
    verifyReference(result, input.merchantReference, 'CANCEL_PAYMENT');
    return {
      ...current,
      providerPaymentId:
        readString(result.tradeNo) ?? current.providerPaymentId,
      providerRequestId: readString(result.traceId),
      status: ProviderPaymentStatus.FAILED,
    };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    assertCny(input.currency, 'REFUND_PAYMENT');
    assertMerchantReference(input.paymentId, 'REFUND_PAYMENT');
    assertMerchantReference(input.refundId, 'REFUND_PAYMENT');
    const result = await this.execute(
      'alipay.trade.refund',
      {
        outRequestNo: input.refundId,
        outTradeNo: input.paymentId,
        refundAmount: minorUnitsToAlipayAmount(input.amount),
      },
      'REFUND_PAYMENT',
      true,
    );
    verifyReference(result, input.paymentId, 'REFUND_PAYMENT');
    const returnedAmount = optionalAmount(result.refundFee);
    if (returnedAmount !== null && returnedAmount !== input.amount) {
      throw providerMismatch('REFUND_PAYMENT', 'refund amount');
    }
    const status =
      readString(result.fundChange) === 'Y'
        ? ProviderRefundStatus.SUCCEEDED
        : ProviderRefundStatus.PENDING;
    return {
      amount: input.amount,
      currency: CNY,
      failureCode: null,
      failureMessage: null,
      providerPaymentId: readString(result.tradeNo) ?? input.providerPaymentId,
      providerRefundId: input.refundId,
      providerRequestId: readString(result.traceId),
      status,
    };
  }

  async getRefund(input: GetRefundInput): Promise<GetRefundResult> {
    assertCny(input.currency, 'GET_REFUND');
    assertMerchantReference(input.merchantReference, 'GET_REFUND');
    assertMerchantReference(input.refundId, 'GET_REFUND');
    const result = await this.execute(
      'alipay.trade.fastpay.refund.query',
      {
        outRequestNo: input.refundId,
        outTradeNo: input.merchantReference,
      },
      'GET_REFUND',
      false,
    );
    verifyReference(result, input.merchantReference, 'GET_REFUND');
    const returnedAmount = optionalAmount(
      result.refundAmount ?? result.refundFee,
    );
    if (returnedAmount !== null && returnedAmount !== input.amount) {
      throw providerMismatch('GET_REFUND', 'refund amount');
    }
    return {
      amount: input.amount,
      currency: CNY,
      failureCode: null,
      failureMessage: null,
      providerPaymentId: readString(result.tradeNo) ?? input.providerPaymentId,
      providerRefundId: input.providerRefundId ?? input.refundId,
      providerRequestId: readString(result.traceId),
      status:
        readString(result.refundStatus) === 'REFUND_SUCCESS'
          ? ProviderRefundStatus.SUCCEEDED
          : ProviderRefundStatus.PENDING,
    };
  }

  async verifyWebhook(
    input: VerifyWebhookInput,
  ): Promise<VerifiedWebhookEvent> {
    const sdk = this.requireSdk('VERIFY_WEBHOOK');
    if (
      !input.contentType
        ?.toLowerCase()
        .startsWith('application/x-www-form-urlencoded') ||
      !input.parsedForm
    ) {
      throw invalidWebhook('Alipay webhook must be form-urlencoded.');
    }
    const form = { ...input.parsedForm };
    if (!readString(form.sign)) {
      throw invalidSignature();
    }
    const signatureValid = await Promise.resolve(sdk.checkNotifySignV2(form));
    if (!signatureValid) {
      throw invalidSignature();
    }
    const appId = requiredForm(form, 'app_id');
    const sellerId = requiredForm(form, 'seller_id');
    if (appId !== this.appId || sellerId !== this.sellerId) {
      throw invalidWebhook('Alipay application or seller identity mismatch.');
    }
    const notifyId = requiredForm(form, 'notify_id');
    const merchantReference = requiredForm(form, 'out_trade_no');
    const tradeStatus = requiredForm(form, 'trade_status');
    const amount = alipayAmountToMinorUnits(requiredForm(form, 'total_amount'));
    const refundAmountText = readString(form.refund_fee);
    const refundAmount = refundAmountText
      ? alipayAmountToMinorUnits(refundAmountText)
      : null;
    assertMerchantReference(merchantReference, 'VERIFY_WEBHOOK');
    const providerPaymentId = readString(form.trade_no);
    const targetStatus = webhookPaymentStatus(tradeStatus);
    if (
      targetStatus === ProviderPaymentStatus.SUCCEEDED &&
      !providerPaymentId
    ) {
      throw invalidWebhook('Successful Alipay notification has no trade_no.');
    }
    const occurredAt = parseAlipayDate(
      form.gmt_payment ?? form.gmt_create ?? form.notify_time,
      this.now(),
    );
    const normalizedPayload = {
      appId,
      eventType: tradeStatus,
      merchantReference,
      notifyId,
      providerPaymentId,
      refundAmount: refundAmountText,
      sellerId,
      totalAmount: requiredForm(form, 'total_amount'),
    };

    return {
      action:
        tradeStatus === 'WAIT_BUYER_PAY'
          ? {
              kind: 'IGNORE',
              reason: 'Alipay trade remains WAIT_BUYER_PAY.',
            }
          : tradeStatus === 'TRADE_CLOSED' &&
              refundAmount !== null &&
              refundAmount > 0
            ? {
                kind: 'IGNORE',
                reason:
                  'Alipay closed trade contains refund evidence and requires refund reconciliation.',
              }
            : {
                amount,
                currency: CNY,
                kind: 'PAYMENT_TRANSITION',
                merchantReference,
                orderId: null,
                paymentId: null,
                providerCheckoutSessionId: null,
                providerPaymentId,
                targetStatus,
              },
      eventType: `alipay.trade.${tradeStatus.toLowerCase()}`,
      occurredAt,
      payload: normalizedPayload,
      payloadHash: createHash('sha256')
        .update(Buffer.from(input.rawBody))
        .digest('hex'),
      paymentAssertion: {
        amount,
        currency: CNY,
        merchantReference,
      },
      provider: this.name,
      providerEventId: notifyId,
    };
  }

  private async queryPayment(input: {
    fallbackAmount?: number;
    merchantReference: string;
    providerPaymentId: string | null;
  }): Promise<ProviderPayment> {
    let result: AlipaySdkCommonResult;
    try {
      result = await this.execute(
        'alipay.trade.query',
        {
          outTradeNo: input.merchantReference,
          ...(input.providerPaymentId
            ? { tradeNo: input.providerPaymentId }
            : {}),
        },
        'GET_PAYMENT',
        false,
      );
    } catch (error: unknown) {
      if (
        error instanceof PaymentProviderError &&
        error.code === 'ACQ.TRADE_NOT_EXIST' &&
        input.fallbackAmount !== undefined
      ) {
        return {
          amount: input.fallbackAmount,
          currency: CNY,
          providerPaymentId: null,
          providerRequestId: error.requestId,
          refundedAmount: 0,
          status: ProviderPaymentStatus.PENDING,
        };
      }
      throw error;
    }
    verifyReference(result, input.merchantReference, 'GET_PAYMENT');
    const remoteAmount = optionalAmount(result.totalAmount);
    const amount = remoteAmount ?? input.fallbackAmount;
    if (amount === undefined) {
      throw providerMismatch('GET_PAYMENT', 'total amount');
    }
    if (input.fallbackAmount !== undefined && amount !== input.fallbackAmount) {
      throw providerMismatch('GET_PAYMENT', 'total amount');
    }
    const refundedAmount = optionalAmount(
      result.refundAmount ?? result.refundFee,
    );
    return {
      amount,
      currency: CNY,
      providerPaymentId: readString(result.tradeNo),
      providerRequestId: readString(result.traceId),
      refundedAmount,
      status: queryPaymentStatus(
        requiredString(result.tradeStatus, 'ALIPAY_TRADE_STATUS_MISSING'),
        refundedAmount,
      ),
    };
  }

  private async execute(
    method: string,
    bizContent: Record<string, unknown>,
    operation: PaymentProviderOperation,
    mutation: boolean,
  ): Promise<AlipaySdkCommonResult> {
    const sdk = this.requireSdk(operation);
    for (let attempt = 1; attempt <= this.maxRequestAttempts; attempt += 1) {
      let result: AlipaySdkCommonResult;
      try {
        result = await sdk.exec(method, { bizContent });
      } catch (error: unknown) {
        const mapped = mapRequestError(error, operation, mutation);
        if (!mapped.retryable || attempt === this.maxRequestAttempts) {
          throw mapped;
        }
        await this.sleep(backoffMilliseconds(attempt, this.random));
        continue;
      }
      if (String(result.code) === '10000') {
        return result;
      }
      const code =
        readString(result.subCode ?? result.sub_code) ?? String(result.code);
      const retryable = isRetryableCode(code);
      const mapped = new PaymentProviderError(
        this.name,
        operation,
        code.slice(0, 100),
        'Alipay rejected the provider request.',
        readString(result.traceId),
        mutation && retryable,
        retryable,
      );
      if (!retryable || attempt === this.maxRequestAttempts) {
        throw mapped;
      }
      await this.sleep(backoffMilliseconds(attempt, this.random));
    }
    throw new Error('Alipay request retry loop exhausted unexpectedly.');
  }

  private requireSdk(operation: PaymentProviderOperation): AlipaySdkLike {
    if (!this.sdk) {
      throw new PaymentProviderError(
        this.name,
        operation,
        'PROVIDER_NOT_CONFIGURED',
        'Alipay sandbox configuration is missing.',
      );
    }
    return this.sdk;
  }
}

function validateOptions(options: AlipayProviderOptions): URL {
  if (
    !options.appId.trim() ||
    !options.sellerId.trim() ||
    !options.privateKey.trim() ||
    !options.notifyUrl.trim() ||
    !options.returnUrl.trim()
  ) {
    throw new Error('Enabled Alipay configuration is incomplete.');
  }
  if (options.environment === 'production' && !options.allowProduction) {
    throw new Error('Alipay production mode requires explicit authorization.');
  }
  const certMode = Boolean(
    options.appCertContent &&
    options.alipayPublicCertContent &&
    options.alipayRootCertContent,
  );
  if (options.environment === 'production' && !certMode) {
    throw new Error('Alipay production mode requires certificate mode.');
  }
  if (!certMode && !options.alipayPublicKey?.trim()) {
    throw new Error(
      'Alipay public-key or complete certificate mode is required.',
    );
  }
  const gateway = parseUrl(
    options.gatewayUrl,
    'ALIPAY_GATEWAY_URL must be a valid URL.',
  );
  const expectedHost =
    options.environment === 'production'
      ? 'openapi.alipay.com'
      : 'openapi-sandbox.dl.alipaydev.com';
  if (
    gateway.protocol !== 'https:' ||
    gateway.host !== expectedHost ||
    gateway.pathname !== '/gateway.do'
  ) {
    throw new Error(
      `Alipay ${options.environment} gateway must be https://${expectedHost}/gateway.do.`,
    );
  }
  validateCallbackUrl(options.notifyUrl, options.environment, 'notify');
  validateCallbackUrl(
    options.returnUrl.replace(
      '{paymentId}',
      '00000000-0000-4000-8000-000000000000',
    ),
    options.environment,
    'return',
  );
  return gateway;
}

function validateCallbackUrl(
  value: string,
  environment: 'production' | 'sandbox',
  label: string,
): void {
  const parsed = parseUrl(value, `Alipay ${label} URL must be valid.`);
  if (
    !new Set(['http:', 'https:']).has(parsed.protocol) ||
    (environment === 'production' && parsed.protocol !== 'https:')
  ) {
    throw new Error(`Alipay ${label} URL uses an unsafe protocol.`);
  }
}

function paymentReturnUrl(template: string, paymentId: string): string {
  return template.includes('{paymentId}')
    ? template.replace('{paymentId}', encodeURIComponent(paymentId))
    : template;
}

function paymentSubject(input: CreatePaymentInput): string {
  const subject = input.lines
    .map((line) => line.name)
    .join(', ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 128);
  return subject || `PayFlow order ${input.orderId}`;
}

function assertCny(
  currency: string,
  operation: PaymentProviderOperation,
): void {
  if (currency !== CNY) {
    throw new PaymentProviderError(
      'ALIPAY',
      operation,
      'ALIPAY_CURRENCY_UNSUPPORTED',
      'Alipay Stage 11 accepts CNY only.',
    );
  }
}

function assertMerchantReference(
  reference: string,
  operation: PaymentProviderOperation,
): void {
  if (
    reference.length === 0 ||
    reference.length > 64 ||
    !/^[A-Za-z0-9_-]+$/.test(reference)
  ) {
    throw new PaymentProviderError(
      'ALIPAY',
      operation,
      'ALIPAY_MERCHANT_REFERENCE_INVALID',
      'Alipay merchant reference must contain 1-64 safe characters.',
    );
  }
}

function queryPaymentStatus(
  status: string,
  refundedAmount: number | null,
): ProviderPaymentStatus {
  switch (status) {
    case 'WAIT_BUYER_PAY':
      return ProviderPaymentStatus.PENDING;
    case 'TRADE_SUCCESS':
    case 'TRADE_FINISHED':
      return ProviderPaymentStatus.SUCCEEDED;
    case 'TRADE_CLOSED':
      return refundedAmount !== null && refundedAmount > 0
        ? ProviderPaymentStatus.SUCCEEDED
        : ProviderPaymentStatus.FAILED;
    default:
      throw new PaymentProviderError(
        'ALIPAY',
        'GET_PAYMENT',
        'ALIPAY_TRADE_STATUS_UNKNOWN',
        'Alipay returned an unsupported trade status.',
        null,
        true,
        false,
      );
  }
}

function webhookPaymentStatus(
  status: string,
):
  | typeof ProviderPaymentStatus.PROCESSING
  | typeof ProviderPaymentStatus.SUCCEEDED
  | typeof ProviderPaymentStatus.FAILED {
  switch (status) {
    case 'WAIT_BUYER_PAY':
      return ProviderPaymentStatus.PROCESSING;
    case 'TRADE_SUCCESS':
    case 'TRADE_FINISHED':
      return ProviderPaymentStatus.SUCCEEDED;
    case 'TRADE_CLOSED':
      return ProviderPaymentStatus.FAILED;
    default:
      throw invalidWebhook(
        'Alipay notification has an unsupported trade status.',
      );
  }
}

function verifyReference(
  result: AlipaySdkCommonResult,
  expected: string,
  operation: PaymentProviderOperation,
): void {
  const returned = readString(result.outTradeNo ?? result.out_trade_no);
  if (!returned || returned !== expected) {
    throw providerMismatch(operation, 'merchant reference');
  }
}

function optionalAmount(value: unknown): number | null {
  const amount = readString(value);
  return amount ? alipayAmountToMinorUnits(amount) : null;
}

function requiredForm(
  form: Readonly<Record<string, string>>,
  key: string,
): string {
  const value = readString(form[key]);
  if (!value) {
    throw invalidWebhook(`Alipay notification is missing ${key}.`);
  }
  return value;
}

function requiredString(value: unknown, code: string): string {
  const result = readString(value);
  if (!result) {
    throw new PaymentProviderError(
      'ALIPAY',
      'GET_PAYMENT',
      code,
      'Alipay response is missing a required field.',
    );
  }
  return result;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseUrl(value: string, message: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(message);
  }
}

function parseAlipayDate(value: unknown, fallback: number): Date {
  const text = readString(value);
  if (!text) {
    return new Date(fallback);
  }
  const parsed = new Date(`${text.replace(' ', 'T')}+08:00`);
  return Number.isNaN(parsed.valueOf()) ? new Date(fallback) : parsed;
}

function invalidSignature(): PaymentProviderError {
  return new PaymentProviderError(
    'ALIPAY',
    'VERIFY_WEBHOOK',
    'WEBHOOK_SIGNATURE_INVALID',
    'Alipay webhook signature verification failed.',
  );
}

function invalidWebhook(message: string): PaymentProviderError {
  return new PaymentProviderError(
    'ALIPAY',
    'VERIFY_WEBHOOK',
    'ALIPAY_WEBHOOK_INVALID',
    message,
  );
}

function providerMismatch(
  operation: PaymentProviderOperation,
  field: string,
): PaymentProviderError {
  return new PaymentProviderError(
    'ALIPAY',
    operation,
    'ALIPAY_RESPONSE_MISMATCH',
    `Alipay response ${field} does not match the local request.`,
  );
}

function mapRequestError(
  error: unknown,
  operation: PaymentProviderOperation,
  mutation: boolean,
): PaymentProviderError {
  if (error instanceof PaymentProviderError) {
    return error;
  }
  if (error instanceof AlipayRequestError) {
    const retryable =
      error.responseHttpStatus === 408 ||
      error.responseHttpStatus === 429 ||
      (error.responseHttpStatus !== undefined &&
        error.responseHttpStatus >= 500);
    return new PaymentProviderError(
      'ALIPAY',
      operation,
      (error.code ?? 'ALIPAY_REQUEST_FAILED').slice(0, 100),
      'Alipay request failed before a verified response arrived.',
      error.traceId ?? null,
      mutation && retryable,
      retryable,
    );
  }
  return new PaymentProviderError(
    'ALIPAY',
    operation,
    'ALIPAY_REQUEST_FAILED',
    'Alipay request failed before a verified response arrived.',
    null,
    mutation,
    true,
  );
}

function isRetryableCode(code: string): boolean {
  return new Set([
    '20000',
    'ACQ.SYSTEM_ERROR',
    'SYSTEM_ERROR',
    'UNKNOWN_ERROR',
  ]).has(code);
}

function backoffMilliseconds(attempt: number, random: () => number): number {
  const jitter = Math.floor(Math.max(0, Math.min(random(), 0.999)) * 100);
  return 100 * 2 ** (attempt - 1) + jitter;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
