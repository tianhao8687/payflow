import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
} from '@opentelemetry/api';

export interface TraceCarrier {
  traceparent?: string;
  tracestate?: string;
}

export interface SpanOptions {
  attributes?: Attributes;
  carrier?: TraceCarrier;
  kind?: SpanKind;
}

const tracer = trace.getTracer('@payflow/observability', '0.1.0');

export { SpanKind };

export function captureTraceContext(): TraceCarrier {
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

export async function withSpan<T>(
  name: string,
  options: SpanOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const parent = options.carrier
    ? propagation.extract(context.active(), options.carrier)
    : context.active();

  return tracer.startActiveSpan(
    name,
    { attributes: options.attributes, kind: options.kind },
    parent,
    async (span) => {
      try {
        return await operation();
      } catch (error: unknown) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function setActiveSpanAttributes(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}

export function activeTraceFields(): {
  spanId?: string;
  traceId?: string;
} {
  const active = trace.getActiveSpan()?.spanContext();
  return active?.traceId && active.spanId
    ? { spanId: active.spanId, traceId: active.traceId }
    : {};
}
