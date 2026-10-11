import { describe, expect, it } from "vitest";
import type { RedisClient } from "../../src/config/redis.js";
import { RateLimitService } from "../../src/services/RateLimitService.js";
import { FakeRedisHub } from "../helpers/fakeRedis.js";

describe("RateLimitService", () => {
  it("allows up to the per-minute limit, then asks to wait until the window turns", async () => {
    let t = 1_000_000;
    const r = new RateLimitService(new FakeRedisHub().client() as unknown as RedisClient, { perMinute: 3, perHour: 100, perDay: 500, minGapMs: 0, maxGapMs: 0 }, () => t);
    for (let i = 0; i < 3; i++) expect((await r.acquire("g")).ok).toBe(true);
    const blocked = await r.acquire("g");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toMatch(/minute/);
      expect(blocked.retryInMs).toBeGreaterThan(0);
      expect(blocked.retryInMs).toBeLessThanOrEqual(60_250);
    }
    expect(await r.usage("g")).toEqual({ minute: 3, hour: 3, day: 3 });
    t += 60_000;
    expect((await r.acquire("g")).ok).toBe(true);
    // another gym has its own counters
    expect((await r.acquire("other")).ok).toBe(true);
  });

  it("enforces a pause between two messages from the same gym", async () => {
    let t = 5_000_000;
    const r = new RateLimitService(new FakeRedisHub().client() as unknown as RedisClient, { perMinute: 10, perHour: 100, perDay: 500, minGapMs: 3000, maxGapMs: 3000 }, () => t);
    expect((await r.acquire("g")).ok).toBe(true);
    const again = await r.acquire("g");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("pacing");
    t += 3001;
    expect((await r.acquire("g")).ok).toBe(true);
  });

  it("the hourly limit applies even when each minute is under its cap", async () => {
    let t = 0;
    const r = new RateLimitService(new FakeRedisHub().client() as unknown as RedisClient, { perMinute: 10, perHour: 2, perDay: 500, minGapMs: 0, maxGapMs: 0 }, () => t);
    expect((await r.acquire("g")).ok).toBe(true);
    t += 61_000;
    expect((await r.acquire("g")).ok).toBe(true);
    t += 61_000;
    const b = await r.acquire("g");
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toMatch(/hour/);
  });
});
