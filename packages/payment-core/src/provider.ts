export const PAYMENT_PROVIDER = Symbol.for(
  '@payflow/payment-core/PaymentProvider',
);

export const PaymentProviderCapability = {
  PAYMENT: 'PAYMENT',
  REFUND: 'REFUND',
  WEBHOOK: 'WEBHOOK',
} as const;

export type PaymentProviderCapability =
  (typeof PaymentProviderCapability)[keyof typeof PaymentProviderCapability];

export const ProviderPaymentStatus = {
  FAILED: 'FAILED',
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCEEDED: 'SUCCEEDED',
} as const;

export type ProviderPaymentStatus =
  (typeof ProviderPaymentStatus)[keyof typeof ProviderPaymentStatus];

export const ProviderRefundStatus = {
  FAILED: 'FAILED',
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
} as const;

export type ProviderRefundStatus =
  (typeof ProviderRefundStatus)[keyof typeof ProviderRefundStatus];

export interface PaymentLine {
  name: string;
  quantity: number;
  sku: string;
  unitAmount: number;
}

export interface CreatePaymentInput {
  amount: number;
  cancelUrl: string;
  currency: string;
  idempotencyKey: string;
  lines: PaymentLine[];
  orderId: string;
  paymentId: string;
  successUrl: string;
}

export interface CreatePaymentResult {
  amount: number;
  currency: string;
  expiresAt: Date;
  providerCheckoutSessionId: string;
  providerPaymentId: string | null;
  providerRequestId: string | null;
  redirectUrl: string;
  status: ProviderPaymentStatus;
}

export interface ProviderPayment {
  amount: number;
  currency: string;
  providerPaymentId: string;
  providerRequestId: string | null;
  status: ProviderPaymentStatus;
}

export interface CapturePaymentInput {
  idempotencyKey: string;
  providerPaymentId: string;
}

export type CapturePaymentResult = ProviderPayment;

export interface CancelPaymentInput {
  idempotencyKey: string;
  providerPaymentId: string;
}

export type CancelPaymentResult = ProviderPayment;

export interface RefundPaymentInput {
  amount: number;
  idempotencyKey: string;
  orderId: string;
  paymentId: string;
  providerPaymentId: string;
  refundId: string;
  refundRequestId: string;
}

export interface RefundPaymentResult {
  amount: number;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
  providerPaymentId: string | null;
  providerRefundId: string;
  providerRequestId: string | null;
  status: ProviderRefundStatus;
}

export interface VerifyWebhookInput {
  rawBody: Uint8Array;
  signature: string;
}

export interface ProviderWebhookIgnoredAction {
  kind: 'IGNORE';
  reason: string;
}

export interface ProviderWebhookRejectedAction {
  kind: 'REJECT';
  reason: string;
}

export interface ProviderPaymentTransitionAction {
  amount: number | null;
  currency: string | null;
  kind: 'PAYMENT_TRANSITION';
  orderId: string;
  paymentId: string;
  providerCheckoutSessionId: string | null;
  providerPaymentId: string | null;
  targetStatus:
    | typeof ProviderPaymentStatus.PROCESSING
    | typeof ProviderPaymentStatus.SUCCEEDED
    | typeof ProviderPaymentStatus.FAILED;
}

export interface ProviderRefundSyncAction {
  amount: number;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
  kind: 'REFUND_SYNC';
  orderId: string;
  paymentId: string;
  providerPaymentId: string | null;
  providerRefundId: string;
  providerRequestId: string | null;
  refundId: string;
  status: ProviderRefundStatus;
}

export type ProviderWebhookAction =
  | ProviderWebhookIgnoredAction
  | ProviderWebhookRejectedAction
  | ProviderPaymentTransitionAction
  | ProviderRefundSyncAction;

export interface VerifiedWebhookEvent {
  action: ProviderWebhookAction;
  eventType: string;
  occurredAt: Date;
  payload: unknown;
  provider: string;
  providerEventId: string;
}

export interface PaymentProvider {
  readonly name: string;

  isConfigured(capability: PaymentProviderCapability): boolean;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  getPayment(providerPaymentId: string): Promise<ProviderPayment>;

  capturePayment?(input: CapturePaymentInput): Promise<CapturePaymentResult>;

  cancelPayment?(input: CancelPaymentInput): Promise<CancelPaymentResult>;

  refundPayment(input: RefundPaymentInput): Promise<RefundPaymentResult>;

  verifyWebhook(input: VerifyWebhookInput): Promise<VerifiedWebhookEvent>;
}
