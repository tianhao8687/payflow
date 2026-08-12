import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationFields {
  orderId?: string;
  paymentId?: string;
  provider?: string;
  providerEventId?: string;
  refundId?: string;
  requestId?: string;
  webhookEventId?: string;
}

const correlationStorage = new AsyncLocalStorage<CorrelationFields>();

export function runWithCorrelation<T>(
  fields: CorrelationFields,
  callback: () => T,
): T {
  return correlationStorage.run(compact(fields), callback);
}

export function enrichCorrelation(fields: CorrelationFields): void {
  const current = correlationStorage.getStore();
  if (current) {
    Object.assign(current, compact(fields));
  }
}

export function currentCorrelation(): CorrelationFields {
  return { ...(correlationStorage.getStore() ?? {}) };
}

function compact(fields: CorrelationFields): CorrelationFields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => Boolean(value)),
  );
}
