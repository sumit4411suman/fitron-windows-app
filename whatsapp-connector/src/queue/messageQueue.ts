import { Queue, type JobsOptions } from "bullmq";
import type { RedisClient } from "../config/redis.js";
import { QUEUE_NAME, type SendJob } from "../types/index.js";

export const JOB_OPTIONS: JobsOptions = {
  attempts: 6,
  // 30s, 60s, 120s, 240s, 480s: a flaky WhatsApp link gets several chances over ~15 minutes before the message fails.
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** What the API needs from the queue. BullMQ in production, an in-memory stand-in in unit tests. */
export interface MessageQueue {
  enqueue(job: SendJob, opts?: { delayMs?: number }): Promise<void>;
  remove(messageId: string): Promise<void>;
  /** Messages waiting or in flight for one gym. */
  sizeForGym(gymId: string): Promise<number>;
  counts(): Promise<{ waiting: number; active: number; delayed: number; failed: number }>;
  close(): Promise<void>;
}

/**
 * The send queue. The job id is the message id, so a message can never be queued twice; the per-gym size is tracked in
 * a Redis counter that the worker decrements when a job reaches a final state.
 */
export class BullMessageQueue implements MessageQueue {
  readonly queue: Queue<SendJob>;

  constructor(
    private readonly redis: RedisClient,
    private readonly queuedKey: (gymId: string) => string,
  ) {
    this.queue = new Queue<SendJob>(QUEUE_NAME, { connection: redis, defaultJobOptions: JOB_OPTIONS });
  }

  async enqueue(job: SendJob, opts: { delayMs?: number } = {}): Promise<void> {
    await this.queue.add("send", job, { jobId: job.messageId, ...(opts.delayMs ? { delay: opts.delayMs } : {}) });
    await this.redis.incr(this.queuedKey(job.gymId));
  }

  async remove(messageId: string): Promise<void> {
    const job = await this.queue.getJob(messageId);
    if (!job) return;
    const gymId = job.data.gymId;
    await job.remove();
    await decrementQueued(this.redis, this.queuedKey(gymId));
  }

  async sizeForGym(gymId: string): Promise<number> {
    return Number((await this.redis.get(this.queuedKey(gymId))) ?? 0);
  }

  async counts() {
    const c = await this.queue.getJobCounts("waiting", "active", "delayed", "failed");
    return { waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0 };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/** Never below zero: a counter that drifted (a crash between add and incr) heals instead of blocking a gym. */
export async function decrementQueued(redis: RedisClient, key: string): Promise<void> {
  const v = await redis.decr(key);
  if (v < 0) await redis.set(key, "0");
}
