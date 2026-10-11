import type { Worker } from "bullmq";
import { env } from "../config/env.js";
import { createRedis } from "../config/redis.js";
import { createMessageWorker } from "../queue/messageWorker.js";
import { MessageLogService } from "../services/MessageLogService.js";
import { REDIS_KEYS, type SendJob } from "../types/index.js";
import { deriveKey } from "../utils/encryption.js";
import { BaileysProvider } from "../whatsapp/BaileysProvider.js";
import { WwebjsProvider } from "../whatsapp/WwebjsProvider.js";
import { WhatsAppManager } from "../whatsapp/WhatsAppManager.js";
import type { WhatsAppProvider } from "../whatsapp/provider.js";
import type { Container } from "./container.js";

export type WorkerRuntime = { manager: WhatsAppManager; worker: Worker<SendJob>; stop: () => Promise<void> };

/** Starts the process that owns WhatsApp sockets and consumes the send queue. */
export async function startWorker(c: Container, provider?: WhatsAppProvider): Promise<WorkerRuntime> {
  const e = env();
  const prov = provider ?? (e.WA_ENGINE === "wwebjs" ? new WwebjsProvider({ executablePath: e.CHROMIUM_PATH || undefined }) : new BaileysProvider(deriveKey(e.SESSION_ENCRYPTION_KEY)));
  c.logger.info({ engine: prov.name }, "WhatsApp engine");
  const workerSub = createRedis("worker-sub");
  const { EventBus } = await import("../whatsapp/events.js");
  const bus = new EventBus(c.redis, workerSub);
  const manager = new WhatsAppManager(
    prov,
    c.db,
    c.redis,
    bus,
    {
      authRoot: e.SESSION_STORAGE_PATH,
      qrIdleMs: e.QR_IDLE_MINUTES * 60_000,
      giveUpMs: e.RECONNECT_GIVE_UP_MINUTES * 60_000,
      isWatched: (gymId) => c.sessions.isWatched(gymId),
      optOutKeywords: e.OPT_OUT_KEYWORDS,
      optInKeywords: e.OPT_IN_KEYWORDS,
      optOutReply: e.OPT_OUT_REPLY,
      consentPolicy: { allowTransactionalAfterOptOut: e.ALLOW_TRANSACTIONAL_AFTER_OPT_OUT, requireOptInForTransactional: e.REQUIRE_OPT_IN_FOR_TRANSACTIONAL },
    },
    c.logger,
  );
  await manager.start();

  // Messages left PROCESSING by a worker that died mid-send go back to QUEUED; BullMQ re-delivers their stalled jobs.
  const messages = new MessageLogService(c.db);
  for (const m of await messages.findStuck(new Date(Date.now() - 10 * 60_000))) await messages.markRequeued(m.id, "Worker restarted while sending; retrying.");

  const workerConn = createRedis("worker-queue");
  const worker = createMessageWorker(
    workerConn,
    { manager, messages, rateLimit: c.rateLimit, media: c.media, bus, redis: c.redis, queuedKey: REDIS_KEYS.queued, maxAgeMs: e.MESSAGE_MAX_AGE_HOURS * 3_600_000, offlineRetryMs: e.OFFLINE_RETRY_SECONDS * 1000, logger: c.logger },
    { concurrency: e.WORKER_CONCURRENCY, logger: c.logger },
  );
  c.logger.info({ concurrency: e.WORKER_CONCURRENCY }, "queue worker started");

  return {
    manager,
    worker,
    stop: async () => {
      await worker.close();
      await manager.stop();
      await bus.close();
      await workerSub.quit().catch(() => undefined);
      await workerConn.quit().catch(() => undefined);
    },
  };
}
