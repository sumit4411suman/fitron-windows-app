import { DelayedError } from "bullmq";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/index.js";
import type { RedisClient } from "../../src/config/redis.js";
import { createProcessor } from "../../src/queue/processor.js";
import { MessageLogService } from "../../src/services/MessageLogService.js";
import { RateLimitService } from "../../src/services/RateLimitService.js";
import { REDIS_KEYS } from "../../src/types/index.js";
import { AppError } from "../../src/utils/errors.js";
import { logger } from "../../src/utils/logger.js";
import { EventBus } from "../../src/whatsapp/events.js";
import { MediaService } from "../../src/whatsapp/MediaService.js";
import { FakeDb } from "../helpers/fakeDb.js";
import { FakeRedisHub } from "../helpers/fakeRedis.js";

type Sent = { gymId: string; recipient: string; payload: unknown };

describe("queue processor", () => {
  let db: FakeDb;
  let redis: RedisClient;
  let messages: MessageLogService;
  let sent: Sent[];
  let connected: boolean;
  let sendError: Error | null;
  let mediaRoot: string;
  let rate: RateLimitService;
  let proc: ReturnType<typeof createProcessor>;

  const fakeJob = (messageId: string, gymId: string, attemptsMade = 0) => {
    const j = { id: messageId, data: { messageId, gymId }, attemptsMade, delayedUntil: 0, moveToDelayed: async (ts: number) => void (j.delayedUntil = ts) };
    return j;
  };

  beforeEach(async () => {
    db = new FakeDb();
    const hub = new FakeRedisHub();
    redis = hub.client() as unknown as RedisClient;
    messages = new MessageLogService(db as unknown as PrismaClient);
    sent = [];
    connected = true;
    sendError = null;
    mediaRoot = await mkdtemp(join(tmpdir(), "wa-media-"));
    rate = new RateLimitService(redis, { perMinute: 2, perHour: 100, perDay: 500, minGapMs: 0, maxGapMs: 0 });
    proc = createProcessor({
      manager: {
        isConnected: () => connected,
        send: async (gymId, recipient, payload) => {
          if (sendError) throw sendError;
          sent.push({ gymId, recipient, payload });
          return { providerMessageId: `wamid.${sent.length}` };
        },
      },
      messages,
      rateLimit: rate,
      media: new MediaService(mediaRoot, 1024 * 1024),
      bus: new EventBus(redis, hub.client() as unknown as RedisClient),
      redis,
      queuedKey: REDIS_KEYS.queued,
      maxAgeMs: 3_600_000,
      offlineRetryMs: 1000,
      logger,
    });
  });
  afterEach(() => rm(mediaRoot, { recursive: true, force: true }));

  const queued = async (gymId = "g1", extra: Record<string, unknown> = {}) => {
    const m = await messages.create({ gymId, recipient: "919876543210", message: "hello", ...extra });
    await redis.incr(REDIS_KEYS.queued(gymId));
    return m;
  };

  it("sends a queued text, logs SENT with the provider id and frees the queue slot", async () => {
    const m = await queued();
    await proc(fakeJob(m.id, "g1"));
    expect(sent).toEqual([{ gymId: "g1", recipient: "919876543210", payload: { text: "hello" } }]);
    const row = await messages.get("g1", m.id);
    expect(row).toMatchObject({ status: "SENT", providerMessageId: "wamid.1", attempts: 1 });
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(await redis.get(REDIS_KEYS.queued("g1"))).toBe("0");
  });

  it("waits (delays the job) while WhatsApp is offline instead of failing", async () => {
    connected = false;
    const m = await queued();
    const job = fakeJob(m.id, "g1");
    await expect(proc(job)).rejects.toBeInstanceOf(DelayedError);
    expect(job.delayedUntil).toBeGreaterThan(Date.now() + 500);
    expect(sent).toHaveLength(0);
    expect((await messages.get("g1", m.id)).status).toBe("QUEUED");
    connected = true;
    await proc(job);
    expect(sent).toHaveLength(1);
  });

  it("respects the per-gym rate limit by delaying, not blocking", async () => {
    const a = await queued();
    const b = await queued();
    const c = await queued();
    await proc(fakeJob(a.id, "g1"));
    await proc(fakeJob(b.id, "g1"));
    const job = fakeJob(c.id, "g1");
    await expect(proc(job)).rejects.toBeInstanceOf(DelayedError);
    expect(job.delayedUntil).toBeGreaterThan(Date.now());
    expect(sent).toHaveLength(2);
    // another gym is not held up
    const other = await queued("g2");
    await proc(fakeJob(other.id, "g2"));
    expect(sent).toHaveLength(3);
  });

  it("fails messages that are too old, cancelled, or to numbers not on WhatsApp", async () => {
    const old = await queued("g1", { queuedAt: new Date(Date.now() - 2 * 3_600_000) });
    await proc(fakeJob(old.id, "g1"));
    expect((await messages.get("g1", old.id))).toMatchObject({ status: "FAILED", error: expect.stringMatching(/Not sent within/) });

    const cancelled = await queued();
    await messages.cancel("g1", cancelled.id);
    await proc(fakeJob(cancelled.id, "g1"));
    expect(sent).toHaveLength(0);

    sendError = new AppError("NUMBER_NOT_ON_WHATSAPP", "+919876543210 is not on WhatsApp.");
    const nope = await queued();
    await proc(fakeJob(nope.id, "g1"));
    expect((await messages.get("g1", nope.id))).toMatchObject({ status: "FAILED", error: "+919876543210 is not on WhatsApp." });
    expect(await redis.get(REDIS_KEYS.queued("g1"))).toBe("0");
  });

  it("retries transient errors with backoff and fails on the last attempt", async () => {
    sendError = new Error("socket hiccup");
    const m = await queued();
    await expect(proc(fakeJob(m.id, "g1", 0))).rejects.toThrow("socket hiccup");
    expect((await messages.get("g1", m.id))).toMatchObject({ status: "QUEUED", error: expect.stringMatching(/attempt 1/) });
    await proc(fakeJob(m.id, "g1", 5));
    expect((await messages.get("g1", m.id))).toMatchObject({ status: "FAILED", error: "WhatsApp send failed: socket hiccup" });
  });

  it("a disconnect in the middle of a send requeues rather than fails", async () => {
    sendError = new AppError("WHATSAPP_NOT_CONNECTED", "WhatsApp is not connected.");
    const m = await queued();
    const job = fakeJob(m.id, "g1");
    await expect(proc(job)).rejects.toBeInstanceOf(DelayedError);
    expect((await messages.get("g1", m.id)).status).toBe("QUEUED");
  });

  it("sends media from disk and deletes the file afterwards", async () => {
    const path = join(mediaRoot, "g1", "x.bin");
    await (await import("node:fs/promises")).mkdir(join(mediaRoot, "g1"), { recursive: true });
    await writeFile(path, "%PDF-1.4 hi");
    const m = await queued("g1", { messageType: "PDF", mediaPath: path, mediaName: "invoice.pdf", mediaMimeType: "application/pdf", message: "Your invoice" });
    await proc(fakeJob(m.id, "g1"));
    const p = sent[0]!.payload as { media: { kind: string; fileName: string; caption: string; data: Buffer } };
    expect(p.media).toMatchObject({ kind: "document", fileName: "invoice.pdf", caption: "Your invoice" });
    expect(p.media.data.toString()).toBe("%PDF-1.4 hi");
    expect(await stat(path).catch(() => null)).toBeNull();
    expect((await messages.get("g1", m.id)).mediaPath).toBeNull();
    // a path outside the gym's folder is refused
    const bad = await queued("g1", { messageType: "PDF", mediaPath: join(mediaRoot, "g2", "other.bin"), mediaMimeType: "application/pdf" });
    await proc(fakeJob(bad.id, "g1"));
    expect((await messages.get("g1", bad.id))).toMatchObject({ status: "FAILED", error: expect.stringMatching(/does not belong/) });
  });
});
