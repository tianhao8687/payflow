import { createServer } from 'node:net';

import { trace } from '@opentelemetry/api';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

import { runWithCorrelation } from './context';
import { JsonLogger } from './logger';
import {
  PAYFLOW_METRIC_NAMES,
  recordInboxDispatchFailure,
  recordInboxDispatchLag,
  recordInboxDispatchRetry,
  recordInboxOldestEventAge,
  recordInboxReceived,
  recordPaymentFailure,
  recordPaymentSuccess,
  recordReconciliationIssue,
  recordRefundFailure,
  recordWebhookDuplicate,
  recordWebhookEventConflict,
  recordWebhookProcessing,
} from './metrics';
import { captureTraceContext, SpanKind, withSpan } from './tracing';

describe('PayFlow observability contract', () => {
  let metricsPort: number;
  let sdk: NodeSDK;
  const spans = new InMemorySpanExporter();

  beforeAll(async () => {
    metricsPort = await freePort();
    sdk = new NodeSDK({
      metricReader: new PrometheusExporter({
        host: '127.0.0.1',
        port: metricsPort,
      }),
      spanProcessors: [new SimpleSpanProcessor(spans)],
    });
    sdk.start();
  });

  afterAll(async () => {
    await sdk.shutdown();
  });

  it('emits one JSON record with correlation and redacts credentials', () => {
    const lines: string[] = [];
    const sampleSecret = ['sk', 'test', 'examplemustberemoved'].join('_');
    const environmentSecret = 'environment-only-password';
    process.env.PAYFLOW_TEST_PASSWORD = environmentSecret;
    const logger = new JsonLogger(
      'payflow-test',
      (line) => lines.push(line),
      (line) => lines.push(line),
    );

    runWithCorrelation(
      {
        orderId: 'order-1',
        paymentId: 'payment-1',
        provider: 'STRIPE',
        providerEventId: 'evt-1',
        requestId: 'request-1',
      },
      () =>
        logger.info('payment.test', {
          authorization: 'Bearer private-token',
          note: `key ${sampleSecret}; ${environmentSecret}; postgresql://user:database-password@localhost/payflow`,
        }),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('private-token');
    expect(lines[0]).not.toContain(sampleSecret);
    expect(lines[0]).not.toContain(environmentSecret);
    expect(lines[0]).not.toContain('database-password');
    delete process.env.PAYFLOW_TEST_PASSWORD;
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event: 'payment.test',
      level: 'info',
      orderId: 'order-1',
      paymentId: 'payment-1',
      provider: 'STRIPE',
      providerEventId: 'evt-1',
      requestId: 'request-1',
      service: 'payflow-test',
    });
  });

  it('propagates one trace across a serialized queue carrier', async () => {
    let producerTraceId = '';
    let consumerTraceId = '';

    await withSpan(
      'queue.publish.test',
      { kind: SpanKind.PRODUCER },
      async () => {
        producerTraceId = trace.getActiveSpan()!.spanContext().traceId;
        const carrier = captureTraceContext();
        expect(carrier.traceparent).toMatch(
          /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/,
        );
        await withSpan(
          'queue.process.test',
          { carrier, kind: SpanKind.CONSUMER },
          async () => {
            consumerTraceId = trace.getActiveSpan()!.spanContext().traceId;
            await Promise.resolve();
          },
        );
      },
    );

    expect(consumerTraceId).toBe(producerTraceId);
    const completed = spans.getFinishedSpans();
    const producer = completed.find(
      (span) => span.name === 'queue.publish.test',
    );
    const consumer = completed.find(
      (span) => span.name === 'queue.process.test',
    );
    expect(consumer?.parentSpanContext?.spanId).toBe(
      producer?.spanContext().spanId,
    );
  });

  it('exports every required low-cardinality payment metric', async () => {
    recordInboxReceived({ provider: 'ALIPAY' });
    recordInboxDispatchLag(0.25, { provider: 'ALIPAY' });
    recordInboxDispatchFailure({ provider: 'ALIPAY' });
    recordInboxDispatchRetry(4.5, { provider: 'ALIPAY' });
    recordInboxOldestEventAge(1.5);
    recordPaymentSuccess({ provider: 'STRIPE' });
    recordPaymentFailure({ provider: 'PAYPAL' });
    recordWebhookDuplicate({ provider: 'STRIPE' });
    recordWebhookEventConflict({ provider: 'PAYPAL' });
    recordWebhookProcessing(0.125, {
      outcome: 'PROCESSED',
      provider: 'STRIPE',
    });
    recordRefundFailure({ provider: 'PAYPAL' });
    recordReconciliationIssue({
      issue_type: 'STATUS_MISMATCH',
      provider: 'STRIPE',
    });

    const response = await fetch(`http://127.0.0.1:${metricsPort}/metrics`);
    expect(response.ok).toBe(true);
    const body = await response.text();
    for (const name of PAYFLOW_METRIC_NAMES) {
      expect(body).toMatch(new RegExp(`(^|\\n)# HELP ${name} `));
    }
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a metrics test port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
