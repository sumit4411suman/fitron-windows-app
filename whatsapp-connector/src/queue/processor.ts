import { DelayedError, type Job } from "bullmq";
import type { RedisClient } from "../config/redis.js";
import type { MessageLogService } from "../services/MessageLogService.js";
import type { RateLimitService } from "../services/RateLimitService.js";
import type { SendJob } from "../types/index.js";
import { AppError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import type { EventBus } from "../whatsapp/events.js";
import type { MediaService } from "../whatsapp/MediaService.js";
import type { WhatsAppManager } from "../whatsapp/WhatsAppManager.js";
import { decrementQueued } from "./messageQueue.js";

export type ProcessorDeps = {
  manager: Pick<WhatsAppManager, "send" | "isConnected">;
  messages: MessageLogService;
  rateLimit: RateLimitService;
  media: MediaService;
  bus: EventBus;
  redis: RedisClient;
  queuedKey: (gymId: string) => string;
  maxAgeMs: number;
  /** How long to wait before looking again when the gym's WhatsApp is offline. */
  offlineRetryMs?: number;
  logger: Logger;
};

/** Errors that mean "stop trying": the message is marked FAILED at once instead of retried. */
const FINAL_CODES = new Set(["NUMBER_NOT_ON_WHATSAPP", "INVALID_PHONE_NUMBER", "FORBIDDEN", "UNSUPPORTED_MEDIA_TYPE", "OPTED_OUT", "CONSENT_REQUIRED"]);

type JobLike = Pick<Job<SendJob>, "data" | "attemptsMade" | "moveToDelayed" | "id">;

/**
 * One queue job = one message. Order of checks: still wanted? -> too old? -> WhatsApp online? -> rate slot? -> send.
 * Waiting (offline, pacing) is done by moving the job to the delayed set, so a slow gym never blocks another gym's
 * messages in the worker's concurrency slots.
 */
export function createProcessor(deps: ProcessorDeps) {
  const log = deps.logger.child({ component: "processor" });

  const finish = async (gymId: string) => decrementQueued(deps.redis, deps.queuedKey(gymId));

  const fail = async (job: JobLike, gymId: string, messageId: string, error: string, mediaPath: string | null) => {
    await deps.messages.markFailed(messageId, error);
    await deps.media.remove(mediaPath);
    await finish(gymId);
    await deps.bus.publish(gymId, { type: "message", data: { messageId, status: "FAILED", error } }).catch(() => undefined);
    log.warn({ gymId, messageId, error, attempts: job.attemptsMade }, "message failed");
  };

  const delay = async (job: JobLike, ms: number, token: string | undefined) => {
    await job.moveToDelayed(Date.now() + ms, token);
    throw new DelayedError();
  };

  return async function process(job: JobLike, token?: string): Promise<void> {
    const { messageId, gymId } = job.data;
    const m = await deps.messages.getForJob(gymId, messageId);
    if (!m) {
      log.warn({ gymId, messageId }, "job for unknown message; dropping");
      await finish(gymId);
      return;
    }
    if (m.status === "CANCELLED" || m.status === "SENT" || m.status === "DELIVERED" || m.status === "READ") {
      await finish(gymId);
      return;
    }
    if (Date.now() - m.queuedAt.getTime() > deps.maxAgeMs) {
      await fail(job, gymId, messageId, `Not sent within ${Math.round(deps.maxAgeMs / 3_600_000)} hours (WhatsApp was not connected).`, m.mediaPath);
      return;
    }
    if (!deps.manager.isConnected(gymId)) {
      if (m.status !== "QUEUED") await deps.messages.markRequeued(messageId, "Waiting for WhatsApp to connect.");
      await delay(job, deps.offlineRetryMs ?? 30_000, token);
      return;
    }
    const slot = await deps.rateLimit.acquire(gymId);
    if (!slot.ok) {
      await delay(job, slot.retryInMs, token);
      return;
    }

    await deps.messages.markProcessing(messageId);
    try {
      let result: { providerMessageId: string | null };
      if (m.messageType === "TEXT" || !m.mediaPath) {
        result = await deps.manager.send(gymId, m.recipient, { text: m.message });
      } else {
        const data = await deps.media.read(gymId, m.mediaPath);
        result = await deps.manager.send(gymId, m.recipient, { media: { kind: m.messageType === "IMAGE" ? "image" : "document", data, mimeType: m.mediaMimeType ?? "application/octet-stream", fileName: m.mediaName ?? undefined, caption: m.message || undefined } });
      }
      await deps.messages.markSent(messageId, result.providerMessageId);
      await deps.media.remove(m.mediaPath);
      await finish(gymId);
      await deps.bus.publish(gymId, { type: "message", data: { messageId, status: "SENT" } }).catch(() => undefined);
      log.info({ gymId, messageId, type: m.messageType }, "message sent");
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e instanceof AppError && e.code === "WHATSAPP_NOT_CONNECTED") {
        await deps.messages.markRequeued(messageId, "WhatsApp disconnected while sending; will retry.");
        await delay(job, deps.offlineRetryMs ?? 30_000, token);
        return;
      }
      if (e instanceof AppError && FINAL_CODES.has(e.code)) {
        await fail(job, gymId, messageId, e.message, m.mediaPath);
        return;
      }
      // Transient: let BullMQ retry with exponential backoff; the last attempt marks it failed.
      const last = job.attemptsMade + 1 >= (JOB_ATTEMPTS ?? 6);
      if (last) {
        await fail(job, gymId, messageId, `WhatsApp send failed: ${e.message}`, m.mediaPath);
        return;
      }
      await deps.messages.markRequeued(messageId, `Send failed (attempt ${job.attemptsMade + 1}): ${e.message}. Retrying.`);
      throw e;
    }
  };
}

export const JOB_ATTEMPTS = 6;
