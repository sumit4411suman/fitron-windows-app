import type { PrismaClient } from "../generated/prisma/index.js";
import { env, type Env } from "../config/env.js";
import { prisma } from "../config/database.js";
import { createRedis, redis, type RedisClient } from "../config/redis.js";
import { BullMessageQueue, type MessageQueue } from "../queue/messageQueue.js";
import { ConsentService } from "../services/ConsentService.js";
import { GymService } from "../services/GymService.js";
import { MessageLogService } from "../services/MessageLogService.js";
import { RateLimitService } from "../services/RateLimitService.js";
import { TemplateService } from "../services/TemplateService.js";
import { REDIS_KEYS } from "../types/index.js";
import { logger, type Logger } from "../utils/logger.js";
import { EventBus } from "../whatsapp/events.js";
import { MediaService } from "../whatsapp/MediaService.js";
import { MessageService } from "../whatsapp/MessageService.js";
import { SessionGateway } from "../whatsapp/SessionGateway.js";

/** Everything the HTTP layer needs. Built once per process; tests build one with fakes. */
export type Container = {
  env: Env;
  db: PrismaClient;
  redis: RedisClient;
  bus: EventBus;
  gyms: GymService;
  consent: ConsentService;
  messageLog: MessageLogService;
  templates: TemplateService;
  sessions: SessionGateway;
  messages: MessageService;
  media: MediaService;
  queue: MessageQueue;
  rateLimit: RateLimitService;
  logger: Logger;
  /** Liveness of the process that owns WhatsApp sessions, for /health. */
  whatsappRunning: () => Promise<boolean>;
  close: () => Promise<void>;
};

export function buildContainer(parts: { env: Env; db: PrismaClient; redis: RedisClient; subscriber: RedisClient; queue?: MessageQueue; logger?: Logger }): Container {
  const e = parts.env;
  const log = parts.logger ?? logger;
  const bus = new EventBus(parts.redis, parts.subscriber);
  const gyms = new GymService(parts.db);
  const consent = new ConsentService(parts.db, { allowTransactionalAfterOptOut: e.ALLOW_TRANSACTIONAL_AFTER_OPT_OUT, requireOptInForTransactional: e.REQUIRE_OPT_IN_FOR_TRANSACTIONAL });
  const messageLog = new MessageLogService(parts.db);
  const templates = new TemplateService(parts.db);
  const sessions = new SessionGateway(parts.db, parts.redis, bus);
  const media = new MediaService(e.MEDIA_STORAGE_PATH, e.MAX_MEDIA_BYTES);
  const queue = parts.queue ?? new BullMessageQueue(parts.redis, REDIS_KEYS.queued);
  const rateLimit = new RateLimitService(parts.redis, { perMinute: e.MAX_MESSAGES_PER_MINUTE, perHour: e.MAX_MESSAGES_PER_HOUR, perDay: e.MAX_MESSAGES_PER_DAY, minGapMs: e.MIN_SEND_GAP_MS, maxGapMs: e.MAX_SEND_GAP_MS });
  const messages = new MessageService(parts.db, consent, messageLog, queue, media, { defaultCountry: e.DEFAULT_COUNTRY, maxQueuePerGym: e.MAX_QUEUE_SIZE_PER_GYM });
  return {
    env: e,
    db: parts.db,
    redis: parts.redis,
    bus,
    gyms,
    consent,
    messageLog,
    templates,
    sessions,
    messages,
    media,
    queue,
    rateLimit,
    logger: log,
    whatsappRunning: () => sessions.workerRunning(),
    close: async () => {
      await bus.close();
      await queue.close().catch(() => undefined);
      await parts.subscriber.quit().catch(() => undefined);
    },
  };
}

export function createContainer(): Container {
  return buildContainer({ env: env(), db: prisma(), redis: redis(), subscriber: createRedis("sub") });
}
