import {
  type ConnectionOptions,
  type Job,
  type JobType,
  Queue,
  QueueEvents,
  UnrecoverableError,
  Worker,
} from 'bullmq';

export const WEBHOOK_QUEUE_NAME = 'payflow-webhooks';
export const WEBHOOK_JOB_NAME = 'process-webhook';
export const WEBHOOK_JOB_ATTEMPTS = 5;

export interface WebhookJobData {
  webhookEventId: string;
}

export interface WebhookQueueJobView {
  attemptsMade: number;
  attemptsTotal: number;
  failedReason: string | null;
  finishedAt: string | null;
  id: string;
  processedAt: string | null;
  state: string;
  timestamp: string;
  webhookEventId: string;
}

export interface WebhookQueueSnapshot {
  counts: Record<string, number>;
  jobs: WebhookQueueJobView[];
}

export type WebhookJob = Job<WebhookJobData, void, typeof WEBHOOK_JOB_NAME>;
export type WebhookWorker = Worker<
  WebhookJobData,
  void,
  typeof WEBHOOK_JOB_NAME
>;

export class PayFlowWebhookQueue {
  private readonly queue: Queue<WebhookJobData, void, typeof WEBHOOK_JOB_NAME>;

  constructor(redisUrl: string, prefix = 'payflow') {
    this.queue = new Queue(WEBHOOK_QUEUE_NAME, {
      connection: redisConnection(redisUrl),
      defaultJobOptions: {
        attempts: WEBHOOK_JOB_ATTEMPTS,
        backoff: { delay: 1_000, type: 'exponential' },
        keepLogs: 50,
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800, count: 2_000 },
      },
      prefix,
    });
  }

  async enqueue(webhookEventId: string): Promise<string> {
    const job = await this.queue.add(
      WEBHOOK_JOB_NAME,
      { webhookEventId },
      { jobId: webhookEventId },
    );
    if (!job.id) {
      throw new Error('BullMQ did not return a webhook job identifier.');
    }
    return job.id;
  }

  async ping(): Promise<void> {
    await this.queue.waitUntilReady();
  }

  async snapshot(limit = 50): Promise<WebhookQueueSnapshot> {
    const types: JobType[] = [
      'active',
      'completed',
      'delayed',
      'failed',
      'prioritized',
      'waiting',
      'waiting-children',
    ];
    const [counts, jobs, paused] = await Promise.all([
      this.queue.getJobCounts(...types),
      this.queue.getJobs(types, 0, Math.max(0, limit - 1), false),
      this.queue.isPaused(),
    ]);
    const views = await Promise.all(
      jobs.map(async (job): Promise<WebhookQueueJobView> => ({
        attemptsMade: job.attemptsMade,
        attemptsTotal: job.opts.attempts ?? 1,
        failedReason: job.failedReason || null,
        finishedAt: iso(job.finishedOn),
        id: String(job.id),
        processedAt: iso(job.processedOn),
        state: await job.getState(),
        timestamp: new Date(job.timestamp).toISOString(),
        webhookEventId: job.data.webhookEventId,
      })),
    );

    return { counts: { ...counts, paused: paused ? 1 : 0 }, jobs: views };
  }

  get rawQueue(): Queue<WebhookJobData, void, typeof WEBHOOK_JOB_NAME> {
    return this.queue;
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createWebhookWorker(
  redisUrl: string,
  processor: (job: WebhookJob) => Promise<void>,
  options: { concurrency?: number; prefix?: string } = {},
): WebhookWorker {
  return new Worker<WebhookJobData, void, typeof WEBHOOK_JOB_NAME>(
    WEBHOOK_QUEUE_NAME,
    processor,
    {
      concurrency: options.concurrency ?? 8,
      connection: redisConnection(redisUrl),
      prefix: options.prefix ?? 'payflow',
    },
  );
}

export function createWebhookQueueEvents(
  redisUrl: string,
  prefix = 'payflow',
): QueueEvents {
  return new QueueEvents(WEBHOOK_QUEUE_NAME, {
    connection: redisConnection(redisUrl),
    prefix,
  });
}

export function unrecoverable(error: unknown): UnrecoverableError {
  return new UnrecoverableError(
    error instanceof Error
      ? error.message
      : 'Permanent webhook processing failure.',
  );
}

export function redisConnection(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://.');
  }

  return {
    maxRetriesPerRequest: null,
    url: parsed.toString(),
  };
}

function iso(value: number | undefined): string | null {
  return value === undefined ? null : new Date(value).toISOString();
}
