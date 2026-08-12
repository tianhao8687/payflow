import {
  type CancelPaymentInput,
  type CancelPaymentResult,
  type CapturePaymentInput,
  type CapturePaymentResult,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  PaymentProviderCapability,
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
  mapPayPalWebhookEvent,
  minorToPayPalValue,
  paypalValueToMinor,
  type PayPalWebhookEvent,
} from './paypal-webhook.mapper';

type FetchLike = typeof fetch;

export interface PayPalProviderOptions {
  baseUrl?: string;
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  webhookId: string;
}

interface PayPalResponse<T> {
  body: T;
  requestId: string | null;
}

export class PayPalProvider implements PaymentProvider {
  readonly name = 'PAYPAL';
  private accessToken: { expiresAt: number; value: string } | null = null;
  private tokenRequest: Promise<string> | null = null;
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetcher: FetchLike;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly webhookId: string;

  constructor(options: PayPalProviderOptions) {
    this.baseUrl = (
      options.baseUrl ?? 'https://api-m.sandbox.paypal.com'
    ).replace(/\/$/, '');
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.webhookId = options.webhookId;
  }

  isConfigured(capability: PaymentProviderCapability): boolean {
    const credentials =
      this.clientId.length > 0 && this.clientSecret.length > 0;
    return capability === PaymentProviderCapability.WEBHOOK
      ? credentials && this.webhookId.length > 0
      : credentials;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    this.assertConfigured(PaymentProviderCapability.PAYMENT, 'CREATE_PAYMENT');
    const response = await this.request<Record<string, unknown>>(
      '/v2/checkout/orders',
      {
        body: {
          intent: 'CAPTURE',
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'PayFlow',
                cancel_url: input.cancelUrl,
                return_url: input.successUrl,
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
              },
            },
          },
          purchase_units: [
            {
              amount: {
                currency_code: input.currency,
                value: minorToPayPalValue(input.amount, input.currency),
              },
              custom_id: input.paymentId,
              description: input.lines
                .map((line) => line.name)
                .join(', ')
                .slice(0, 127),
              invoice_id: input.orderId,
              reference_id: input.paymentId,
            },
          ],
        },
        idempotencyKey: input.idempotencyKey,
        method: 'POST',
        mutation: true,
        operation: 'CREATE_PAYMENT',
      },
    );
    const orderId = requiredString(response.body.id, 'PAYPAL_ORDER_ID_MISSING');
    const link = readApprovalLink(response.body.links);
    const amount = readOrderAmount(response.body);

    if (!link || !amount) {
      throw new PaymentProviderError(
        this.name,
        'CREATE_PAYMENT',
        'PAYPAL_ORDER_INCOMPLETE',
        'PayPal returned an incomplete hosted order.',
        response.requestId,
      );
    }

    return {
      amount: amount.amount,
      currency: amount.currency,
      expiresAt: new Date(this.now() + 6 * 60 * 60 * 1000),
      providerCheckoutSessionId: orderId,
      providerPaymentId: null,
      providerRequestId: response.requestId,
      redirectUrl: link,
      status: ProviderPaymentStatus.PENDING,
    };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    this.assertConfigured(PaymentProviderCapability.PAYMENT, 'GET_PAYMENT');
    const response = await this.request<Record<string, unknown>>(
      `/v2/payments/captures/${encodeURIComponent(providerPaymentId)}`,
      { method: 'GET', mutation: false, operation: 'GET_PAYMENT' },
    );
    const amount = readMoney(response.body.amount);
    const status = readString(response.body.status);

    if (!amount || !status) {
      throw new PaymentProviderError(
        this.name,
        'GET_PAYMENT',
        'PAYPAL_CAPTURE_INCOMPLETE',
        'PayPal returned an incomplete payment capture.',
        response.requestId,
      );
    }

    return {
      amount: amount.amount,
      currency: amount.currency,
      providerPaymentId: readString(response.body.id) ?? providerPaymentId,
      providerRequestId: response.requestId,
      refundedAmount: null,
      status: mapPaymentStatus(status),
    };
  }

  async capturePayment(
    input: CapturePaymentInput,
  ): Promise<CapturePaymentResult> {
    this.assertConfigured(PaymentProviderCapability.PAYMENT, 'CAPTURE_PAYMENT');
    const response = await this.request<Record<string, unknown>>(
      `/v2/checkout/orders/${encodeURIComponent(input.providerPaymentId)}/capture`,
      {
        body: {},
        idempotencyKey: input.idempotencyKey,
        method: 'POST',
        mutation: true,
        operation: 'CAPTURE_PAYMENT',
      },
    );
    const capture = readCapture(response.body);
    const amount = readMoney(capture?.amount);
    const captureId = readString(capture?.id);
    const status = readString(capture?.status);

    if (!capture || !amount || !captureId || !status) {
      throw new PaymentProviderError(
        this.name,
        'CAPTURE_PAYMENT',
        'PAYPAL_CAPTURE_INCOMPLETE',
        'PayPal returned an incomplete capture.',
        response.requestId,
        true,
        true,
      );
    }

    return {
      amount: amount.amount,
      currency: amount.currency,
      providerPaymentId: captureId,
      providerRequestId: response.requestId,
      refundedAmount: 0,
      status: mapPaymentStatus(status),
    };
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentResult> {
    const payment = await this.getPayment(input.providerPaymentId);
    if (payment.status === ProviderPaymentStatus.SUCCEEDED) {
      throw new PaymentProviderError(
        this.name,
        'CANCEL_PAYMENT',
        'PAYPAL_CAPTURE_ALREADY_COMPLETED',
        'A completed PayPal capture cannot be canceled.',
      );
    }

    return { ...payment, status: ProviderPaymentStatus.FAILED };
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult> {
    this.assertConfigured(PaymentProviderCapability.REFUND, 'REFUND_PAYMENT');
    const response = await this.request<Record<string, unknown>>(
      `/v2/payments/captures/${encodeURIComponent(input.providerPaymentId)}/refund`,
      {
        body: {
          amount: {
            currency_code: input.currency,
            value: minorToPayPalValue(input.amount, input.currency),
          },
          custom_id: input.refundId,
          invoice_id: input.refundRequestId,
        },
        idempotencyKey: input.idempotencyKey,
        method: 'POST',
        mutation: true,
        operation: 'REFUND_PAYMENT',
      },
    );
    const providerRefundId = requiredString(
      response.body.id,
      'PAYPAL_REFUND_ID_MISSING',
    );
    const amount = readMoney(response.body.amount);
    const providerStatus = readString(response.body.status);

    if (!amount || !providerStatus) {
      throw new PaymentProviderError(
        this.name,
        'REFUND_PAYMENT',
        'PAYPAL_REFUND_INCOMPLETE',
        'PayPal returned an incomplete refund.',
        response.requestId,
        true,
        true,
      );
    }

    const status = mapRefundStatus(providerStatus);
    return {
      amount: amount.amount,
      currency: amount.currency,
      failureCode:
        status === ProviderRefundStatus.FAILED ? providerStatus : null,
      failureMessage:
        status === ProviderRefundStatus.FAILED
          ? 'PayPal reported that the refund failed.'
          : null,
      providerPaymentId: input.providerPaymentId,
      providerRefundId,
      providerRequestId: response.requestId,
      status,
    };
  }

  async verifyWebhook(
    input: VerifyWebhookInput,
  ): Promise<VerifiedWebhookEvent> {
    this.assertConfigured(PaymentProviderCapability.WEBHOOK, 'VERIFY_WEBHOOK');
    const headers = input.headers ?? {};
    const transmissionId = header(headers, 'paypal-transmission-id');
    const transmissionTime = header(headers, 'paypal-transmission-time');
    const certUrl = header(headers, 'paypal-cert-url');
    const authAlgo = header(headers, 'paypal-auth-algo');

    if (
      !input.signature ||
      !transmissionId ||
      !transmissionTime ||
      !certUrl ||
      !authAlgo
    ) {
      throw invalidSignature();
    }

    const rawEvent = new TextDecoder().decode(input.rawBody);
    let event: PayPalWebhookEvent;
    try {
      event = JSON.parse(rawEvent) as PayPalWebhookEvent;
    } catch {
      throw invalidSignature();
    }

    const verificationBody =
      `{"auth_algo":${JSON.stringify(authAlgo)},` +
      `"cert_url":${JSON.stringify(certUrl)},` +
      `"transmission_id":${JSON.stringify(transmissionId)},` +
      `"transmission_sig":${JSON.stringify(input.signature)},` +
      `"transmission_time":${JSON.stringify(transmissionTime)},` +
      `"webhook_id":${JSON.stringify(this.webhookId)},` +
      `"webhook_event":${rawEvent}}`;
    const response = await this.request<Record<string, unknown>>(
      '/v1/notifications/verify-webhook-signature',
      {
        bodyText: verificationBody,
        method: 'POST',
        mutation: false,
        operation: 'VERIFY_WEBHOOK',
      },
    );

    if (response.body.verification_status !== 'SUCCESS') {
      throw invalidSignature();
    }

    const providerEventId = requiredString(event.id, 'PAYPAL_EVENT_ID_MISSING');
    const eventType = requiredString(
      event.event_type,
      'PAYPAL_EVENT_TYPE_MISSING',
    );
    const occurredAtValue = readString(event.create_time);
    const occurredAt = occurredAtValue
      ? new Date(occurredAtValue)
      : new Date(this.now());

    if (Number.isNaN(occurredAt.valueOf())) {
      throw new PaymentProviderError(
        this.name,
        'VERIFY_WEBHOOK',
        'PAYPAL_EVENT_TIME_INVALID',
        'PayPal webhook contains an invalid event time.',
      );
    }

    return {
      action: mapPayPalWebhookEvent(event),
      eventType,
      occurredAt,
      payload: event,
      provider: this.name,
      providerEventId,
    };
  }

  private async request<T>(
    path: string,
    options: {
      body?: unknown;
      bodyText?: string;
      idempotencyKey?: string;
      method: 'GET' | 'POST';
      mutation: boolean;
      operation: PaymentProviderOperation;
    },
  ): Promise<PayPalResponse<T>> {
    const token = await this.getAccessToken();
    let response: Response;

    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        body:
          options.method === 'POST'
            ? (options.bodyText ?? JSON.stringify(options.body ?? {}))
            : undefined,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
          ...(options.idempotencyKey
            ? { 'PayPal-Request-Id': options.idempotencyKey }
            : {}),
        },
        method: options.method,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new PaymentProviderError(
        this.name,
        options.operation,
        'PAYPAL_NETWORK_ERROR',
        'PayPal request failed before a verified response arrived.',
        null,
        options.mutation,
        true,
      );
    }

    const requestId = response.headers.get('paypal-debug-id');
    const body = await readJson(response);
    if (!response.ok) {
      const record = asRecord(body);
      const code = readString(record?.name) ?? `PAYPAL_HTTP_${response.status}`;
      const message =
        readString(record?.message) ?? 'PayPal rejected the provider request.';
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      throw new PaymentProviderError(
        this.name,
        options.operation,
        code,
        message,
        requestId,
        options.mutation && retryable,
        retryable,
      );
    }

    return { body: body as T, requestId };
  }

  private async getAccessToken(): Promise<string> {
    const cached = this.accessToken;
    if (cached && cached.expiresAt > this.now() + 30_000) {
      return cached.value;
    }

    if (this.tokenRequest) {
      return this.tokenRequest;
    }

    this.tokenRequest = this.fetchAccessToken();
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = null;
    }
  }

  private async fetchAccessToken(): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/v1/oauth2/token`, {
        body: 'grant_type=client_credentials',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new PaymentProviderError(
        this.name,
        'GET_PAYMENT',
        'PAYPAL_OAUTH_NETWORK_ERROR',
        'PayPal OAuth request failed.',
        null,
        false,
        true,
      );
    }

    const body = asRecord(await readJson(response));
    const token = readString(body?.access_token);
    const expiresIn = Number(body?.expires_in);
    if (!response.ok || !token || !Number.isFinite(expiresIn)) {
      throw new PaymentProviderError(
        this.name,
        'GET_PAYMENT',
        'PAYPAL_OAUTH_FAILED',
        'PayPal OAuth credentials were rejected.',
        response.headers.get('paypal-debug-id'),
        false,
        response.status >= 500,
      );
    }

    this.accessToken = {
      expiresAt: this.now() + Math.max(60, expiresIn) * 1000,
      value: token,
    };
    return token;
  }

  private assertConfigured(
    capability: PaymentProviderCapability,
    operation: PaymentProviderOperation,
  ): void {
    if (!this.isConfigured(capability)) {
      throw new PaymentProviderError(
        this.name,
        operation,
        'PROVIDER_NOT_CONFIGURED',
        `PayPal ${capability.toLowerCase()} configuration is missing.`,
      );
    }
  }
}

function invalidSignature(): PaymentProviderError {
  return new PaymentProviderError(
    'PAYPAL',
    'VERIFY_WEBHOOK',
    'WEBHOOK_SIGNATURE_INVALID',
    'PayPal webhook signature verification failed.',
  );
}

function header(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | null {
  const direct =
    headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return readString(direct);
}

function readApprovalLink(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const relation of ['payer-action', 'approve']) {
    const link: unknown = value.find(
      (item: unknown) => asRecord(item)?.rel === relation,
    );
    const href = readString(asRecord(link)?.href);
    if (href) {
      return href;
    }
  }

  return null;
}

function readOrderAmount(
  order: Record<string, unknown>,
): { amount: number; currency: string } | null {
  return readMoney(firstRecord(order.purchase_units)?.amount);
}

function readCapture(
  order: Record<string, unknown>,
): Record<string, unknown> | null {
  const purchaseUnit = firstRecord(order.purchase_units);
  const payments = asRecord(purchaseUnit?.payments);
  return firstRecord(payments?.captures);
}

function readMoney(
  value: unknown,
): { amount: number; currency: string } | null {
  const money = asRecord(value);
  const currency = readString(money?.currency_code)?.toUpperCase();
  const decimal = readString(money?.value);
  if (!currency || !decimal) {
    return null;
  }

  try {
    return { amount: paypalValueToMinor(decimal, currency), currency };
  } catch {
    return null;
  }
}

function mapPaymentStatus(status: string): ProviderPaymentStatus {
  switch (status) {
    case 'COMPLETED':
    case 'PARTIALLY_REFUNDED':
    case 'REFUNDED':
      return ProviderPaymentStatus.SUCCEEDED;
    case 'APPROVED':
    case 'PENDING':
      return ProviderPaymentStatus.PROCESSING;
    case 'DECLINED':
    case 'DENIED':
    case 'FAILED':
    case 'REVERSED':
    case 'VOIDED':
      return ProviderPaymentStatus.FAILED;
    default:
      return ProviderPaymentStatus.PENDING;
  }
}

function mapRefundStatus(status: string): ProviderRefundStatus {
  if (status === 'COMPLETED') {
    return ProviderRefundStatus.SUCCEEDED;
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    return ProviderRefundStatus.FAILED;
  }
  return ProviderRefundStatus.PENDING;
}

function requiredString(value: unknown, code: string): string {
  const result = readString(value);
  if (!result) {
    throw new PaymentProviderError(
      'PAYPAL',
      'GET_PAYMENT',
      code,
      'PayPal response is missing a required identifier.',
    );
  }
  return result;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? asRecord(value[0]) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: 'PayPal returned a non-JSON response.' };
  }
}
