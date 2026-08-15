import {
  type ProviderWebhookAction,
  ProviderPaymentStatus,
  ProviderRefundStatus,
} from '@payflow/payment-core';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PayPalWebhookEvent {
  create_time?: unknown;
  event_type?: unknown;
  id?: unknown;
  resource?: unknown;
}

export function mapPayPalWebhookEvent(
  event: PayPalWebhookEvent,
): ProviderWebhookAction {
  const eventType = readString(event.event_type);
  const resource = asRecord(event.resource);

  if (!eventType || !resource) {
    return reject('PayPal webhook is missing an event type or resource.');
  }

  switch (eventType) {
    case 'CHECKOUT.ORDER.APPROVED':
      return mapOrderApproved(resource);
    case 'PAYMENT.CAPTURE.COMPLETED':
      return mapCapture(resource, ProviderPaymentStatus.SUCCEEDED);
    case 'PAYMENT.CAPTURE.PENDING':
      return mapCapture(resource, ProviderPaymentStatus.PROCESSING);
    case 'PAYMENT.CAPTURE.DECLINED':
    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.REVERSED':
      return mapCapture(resource, ProviderPaymentStatus.FAILED);
    case 'PAYMENT.CAPTURE.REFUNDED':
    case 'PAYMENT.REFUND.COMPLETED':
      return mapRefund(resource, ProviderRefundStatus.SUCCEEDED);
    case 'PAYMENT.REFUND.PENDING':
      return mapRefund(resource, ProviderRefundStatus.PENDING);
    case 'PAYMENT.REFUND.FAILED':
      return mapRefund(resource, ProviderRefundStatus.FAILED);
    default:
      return {
        kind: 'IGNORE',
        reason: `Event type ${eventType} is not handled by PayFlow.`,
      };
  }
}

function mapOrderApproved(
  resource: Record<string, unknown>,
): ProviderWebhookAction {
  const orderId = readString(resource.id);
  const purchaseUnit = firstRecord(resource.purchase_units);
  const paymentId =
    readString(purchaseUnit?.custom_id) ??
    readString(purchaseUnit?.reference_id);
  const localOrderId = readString(purchaseUnit?.invoice_id);

  if (
    !orderId ||
    !paymentId ||
    !localOrderId ||
    !uuidPattern.test(paymentId) ||
    !uuidPattern.test(localOrderId)
  ) {
    return ignored('PayPal approved order has no valid PayFlow identifiers.');
  }

  return {
    kind: 'CAPTURE_PAYMENT',
    orderId: localOrderId,
    paymentId,
    providerCheckoutSessionId: orderId,
  };
}

function mapCapture(
  resource: Record<string, unknown>,
  targetStatus:
    | typeof ProviderPaymentStatus.PROCESSING
    | typeof ProviderPaymentStatus.SUCCEEDED
    | typeof ProviderPaymentStatus.FAILED,
): ProviderWebhookAction {
  const providerPaymentId = readString(resource.id);
  const paymentId = readString(resource.custom_id);
  const orderId = readString(resource.invoice_id);
  const amount = readMoney(resource.amount);
  const relatedIds = asRecord(
    asRecord(resource.supplementary_data)?.related_ids,
  );
  const providerCheckoutSessionId = readString(relatedIds?.order_id);

  if (
    !providerPaymentId ||
    !paymentId ||
    !orderId ||
    !uuidPattern.test(paymentId) ||
    !uuidPattern.test(orderId) ||
    !amount
  ) {
    return ignored(
      'PayPal capture has no valid PayFlow identifiers or amount.',
    );
  }

  return {
    amount: amount.minor,
    currency: amount.currency,
    kind: 'PAYMENT_TRANSITION',
    merchantReference: paymentId,
    orderId,
    paymentId,
    providerCheckoutSessionId,
    providerPaymentId,
    targetStatus,
  };
}

function mapRefund(
  resource: Record<string, unknown>,
  status: ProviderRefundStatus,
): ProviderWebhookAction {
  const providerRefundId = readString(resource.id);
  const refundId = readString(resource.custom_id);
  const amount = readMoney(resource.amount);
  const relatedIds = asRecord(
    asRecord(resource.supplementary_data)?.related_ids,
  );
  const providerPaymentId = readString(relatedIds?.capture_id);

  if (
    !providerRefundId ||
    !refundId ||
    !uuidPattern.test(refundId) ||
    !amount
  ) {
    return ignored('PayPal refund has no valid PayFlow identifiers or amount.');
  }

  return {
    amount: amount.minor,
    currency: amount.currency,
    failureCode:
      status === ProviderRefundStatus.FAILED ? 'PAYPAL_REFUND_FAILED' : null,
    failureMessage:
      status === ProviderRefundStatus.FAILED
        ? 'PayPal reported that the refund failed.'
        : null,
    kind: 'REFUND_SYNC',
    orderId: null,
    paymentId: null,
    providerPaymentId,
    providerRefundId,
    providerRequestId: null,
    refundId,
    status,
  };
}

export function minorToPayPalValue(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('PayPal amount must be a non-negative safe integer.');
  }

  const exponent = currencyExponent(currency);
  if (exponent === 0) {
    return String(amount);
  }

  const factor = 10 ** exponent;
  return `${Math.floor(amount / factor)}.${String(amount % factor).padStart(exponent, '0')}`;
}

export function paypalValueToMinor(value: string, currency: string): number {
  const exponent = currencyExponent(currency);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);

  if (!match) {
    throw new Error('PayPal returned an invalid decimal amount.');
  }

  const whole = match[1] as string;
  const fraction = match[2] ?? '';
  if (fraction.length > exponent) {
    throw new Error('PayPal returned more currency precision than supported.');
  }

  const minor =
    BigInt(whole) * 10n ** BigInt(exponent) +
    BigInt((fraction || '').padEnd(exponent, '0') || '0');

  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('PayPal amount exceeds the safe integer range.');
  }

  return Number(minor);
}

function readMoney(value: unknown): { currency: string; minor: number } | null {
  const money = asRecord(value);
  const currency = readString(money?.currency_code)?.toUpperCase();
  const amount = readString(money?.value);

  if (!currency || !amount) {
    return null;
  }

  try {
    return { currency, minor: paypalValueToMinor(amount, currency) };
  } catch {
    return null;
  }
}

function currencyExponent(currency: string): number {
  const normalized = currency.toUpperCase();
  if (new Set(['HUF', 'JPY', 'TWD']).has(normalized)) {
    return 0;
  }

  if (new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']).has(normalized)) {
    return 3;
  }

  return 2;
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

function ignored(reason: string): ProviderWebhookAction {
  return { kind: 'IGNORE', reason };
}

function reject(reason: string): ProviderWebhookAction {
  return { kind: 'REJECT', reason };
}
