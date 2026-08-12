import {
  JsonLogger,
  observabilityOptionsFromEnv,
  startObservability,
} from '@payflow/observability';
import { config as loadEnvironment } from 'dotenv';

const logger = new JsonLogger('payflow-worker');

loadEnvironment({ quiet: true });

async function main(): Promise<void> {
  const telemetry = startObservability(
    observabilityOptionsFromEnv('payflow-worker', process.env),
  );
  logger.info('observability.started', {
    metricsUrl: telemetry.metricsUrl,
    traceExportEnabled: Boolean(
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    ),
  });

  try {
    const { bootstrap } = await import('./bootstrap');
    const runtime = await bootstrap(logger);
    let closing = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (closing) {
        return;
      }
      closing = true;
      logger.info('worker.shutdown.started', { signal });
      await runtime.close();
      await telemetry.shutdown();
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error: unknown) {
    logger.error('worker.bootstrap.failed', error);
    await telemetry.shutdown();
    process.exitCode = 1;
  }
}

void main();
