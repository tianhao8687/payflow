import { ExportResultCode } from '@opentelemetry/core';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';

export interface ObservabilityRuntime {
  metricsUrl: string | null;
  shutdown(): Promise<void>;
}

export interface ObservabilityOptions {
  environment?: string;
  metricsHost?: string;
  metricsPort?: number;
  otlpEndpoint?: string;
  serviceName: string;
  serviceVersion?: string;
}

let activeRuntime: ObservabilityRuntime | null = null;

export function startObservability(
  options: ObservabilityOptions,
): ObservabilityRuntime {
  if (activeRuntime) {
    return activeRuntime;
  }

  const metricsPort = validPort(options.metricsPort) ? options.metricsPort : 0;
  const metricReader = metricsPort
    ? new PrometheusExporter({
        endpoint: '/metrics',
        host: options.metricsHost ?? '0.0.0.0',
        port: metricsPort,
      })
    : undefined;
  const exporter: SpanExporter = options.otlpEndpoint
    ? new OTLPTraceExporter({ url: traceEndpoint(options.otlpEndpoint) })
    : new DiscardingSpanExporter();
  const sdk = new NodeSDK({
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
      new UndiciInstrumentation(),
    ],
    metricReader,
    resource: resourceFromAttributes({
      'deployment.environment.name': options.environment ?? 'development',
      'service.name': options.serviceName,
      'service.version': options.serviceVersion ?? '0.11.0',
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  sdk.start();

  activeRuntime = {
    metricsUrl: metricsPort
      ? `http://${options.metricsHost ?? '0.0.0.0'}:${metricsPort}/metrics`
      : null,
    async shutdown(): Promise<void> {
      await sdk.shutdown();
      activeRuntime = null;
    },
  };
  return activeRuntime;
}

export function observabilityOptionsFromEnv(
  serviceName: string,
  values: NodeJS.ProcessEnv,
): ObservabilityOptions {
  return {
    environment: values.NODE_ENV ?? 'development',
    metricsHost: values.OTEL_METRICS_HOST ?? '0.0.0.0',
    metricsPort: Number(values.OTEL_METRICS_PORT ?? 0),
    otlpEndpoint:
      values.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      values.OTEL_EXPORTER_OTLP_ENDPOINT ??
      '',
    serviceName: values.OTEL_SERVICE_NAME || serviceName,
    serviceVersion: values.OTEL_SERVICE_VERSION ?? '0.11.0',
  };
}

function traceEndpoint(value: string): string {
  const trimmed = value.replace(/\/$/, '');
  return trimmed.endsWith('/v1/traces') ? trimmed : `${trimmed}/v1/traces`;
}

function validPort(value: number | undefined): value is number {
  return (
    Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65_535
  );
}

class DiscardingSpanExporter implements SpanExporter {
  export(
    _spans: ReadableSpan[],
    resultCallback: (result: { code: ExportResultCode }) => void,
  ): void {
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
