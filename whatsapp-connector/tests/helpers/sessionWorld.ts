import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "../../src/generated/prisma/index.js";
import type { RedisClient } from "../../src/config/redis.js";
import { logger } from "../../src/utils/logger.js";
import { EventBus } from "../../src/whatsapp/events.js";
import { QRManager } from "../../src/whatsapp/QRManager.js";
import { SessionStore } from "../../src/whatsapp/SessionStore.js";
import { WhatsAppManager, type ManagerOptions } from "../../src/whatsapp/WhatsAppManager.js";
import { WhatsAppSession, type SessionOptions } from "../../src/whatsapp/WhatsAppSession.js";
import { FakeDb } from "./fakeDb.js";
import { FakeRedisHub } from "./fakeRedis.js";
import { MockProvider } from "./mockProvider.js";

export type SessionWorld = Awaited<ReturnType<typeof sessionWorld>>;

/** A session/manager test bed: fake db + redis, mock provider, a temp auth folder, and a log of published events. */
export async function sessionWorld(opts: Partial<SessionOptions> = {}) {
  const db = new FakeDb();
  const hub = new FakeRedisHub();
  const redis = hub.client() as unknown as RedisClient;
  const bus = new EventBus(redis, hub.client() as unknown as RedisClient);
  const provider = new MockProvider();
  const authRoot = await mkdtemp(join(tmpdir(), "wa-sess-"));
  let watched = true;
  const events: { gymId: string; event: unknown }[] = [];
  const options: SessionOptions = { authRoot, qrIdleMs: 200, giveUpMs: 60_000, isWatched: async () => watched, backoffBaseMs: 20, backoffMaxMs: 50, ...opts };
  const store = new SessionStore(db as unknown as PrismaClient);
  const qr = new QRManager(redis);
  const makeSession = (gymId: string, hooks = { onIncomingText: async () => undefined, onReceipt: async () => undefined }) => new WhatsAppSession(gymId, provider, store, bus, qr, hooks, options, logger);
  const managerOpts: ManagerOptions = { ...options, optOutKeywords: ["STOP", "UNSUBSCRIBE"], optInKeywords: ["START"], optOutReply: "Opted out.", consentPolicy: { allowTransactionalAfterOptOut: false, requireOptInForTransactional: false }, restoreWindowMs: 60_000 };
  const makeManager = (busOverride?: EventBus) => new WhatsAppManager(provider, db as unknown as PrismaClient, redis, busOverride ?? new EventBus(redis, hub.client() as unknown as RedisClient), managerOpts, logger);
  return {
    db,
    hub,
    redis,
    bus,
    provider,
    store,
    qr,
    authRoot,
    events,
    setWatched: (v: boolean) => (watched = v),
    watch: async (gymId: string) => bus.subscribe(gymId, (e) => events.push({ gymId, event: e })),
    makeSession,
    makeManager,
    cleanup: () => rm(authRoot, { recursive: true, force: true }),
  };
}

export const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

export async function waitUntil(pred: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error("waitUntil timed out");
    await tick(10);
  }
}
