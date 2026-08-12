import { randomUUID } from 'node:crypto';

import {
  createWebhookQueueEvents,
  createWebhookWorker,
  PayFlowWebhookQueue,
} from './index';

const integration =
  process.env.RUN_REDIS_INTEGRATION === 'true' ? describe : describe.skip;

integration('BullMQ webhook retry observability', () => {
  it('retries a transient failure and exposes the completed attempt count', async () => {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const prefix = `payflow-stage-8-${randomUUID()}`;
    const queue = new PayFlowWebhookQueue(redisUrl, prefix);
    const events = createWebhookQueueEvents(redisUrl, prefix);
    let calls = 0;
    const worker = createWebhookWorker(
      redisUrl,
      async () => {
        await Promise.resolve();
        calls += 1;
        if (calls === 1) {
          throw new Error('simulated transient provider timeout');
        }
      },
      { concurrency: 1, prefix },
    );

    try {
      await Promise.all([
        events.waitUntilReady(),
        worker.waitUntilReady(),
        queue.ping(),
      ]);
      const eventId = randomUUID();
      const jobId = await queue.enqueue(eventId);
      const job = await queue.rawQueue.getJob(jobId);
      expect(job).not.toBeNull();
      await job!.waitUntilFinished(events, 15_000);

      const snapshot = await queue.snapshot();
      expect(calls).toBe(2);
      expect(snapshot.counts.completed).toBe(1);
      expect(snapshot.jobs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attemptsMade: 2,
            attemptsTotal: 5,
            id: jobId,
            state: 'completed',
            webhookEventId: eventId,
          }),
        ]),
      );
    } finally {
      await worker.close();
      await events.close();
      await queue.rawQueue.obliterate({ force: true });
      await queue.close();
    }
  }, 20_000);
});
