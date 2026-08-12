export type PaymentProviderOperation =
  | 'CANCEL_PAYMENT'
  | 'CAPTURE_PAYMENT'
  | 'CREATE_PAYMENT'
  | 'GET_PAYMENT'
  | 'REFUND_PAYMENT'
  | 'VERIFY_WEBHOOK';

export class PaymentProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly operation: PaymentProviderOperation,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
