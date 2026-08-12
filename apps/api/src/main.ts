import {
  observabilityOptionsFromEnv,
  startObservability,
} from '@payflow/observability';
import { config as loadEnvironment } from 'dotenv';

import { apiLogger } from './observability';

loadEnvironment({ quiet: true });

async function main(): Promise<void> {
  const telemetry = startObservability(
    observabilityOptionsFromEnv('payflow-api', process.env),
  );
  apiLogger.info('observability.started', {
    metricsUrl: telemetry.metricsUrl,
    traceExportEnabled: Boolean(
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    ),
  });

  try {
    const { bootstrap } = await import('./bootstrap.js');
    const app = await bootstrap();
    let closing = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (closing) {
        return;
      }
      closing = true;
      apiLogger.info('api.shutdown.started', { signal });
      await app.close();
      await telemetry.shutdown();
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error: unknown) {
    apiLogger.error('api.bootstrap.failed', error);
    await telemetry.shutdown();
    process.exitCode = 1;
  }
}

void main();
