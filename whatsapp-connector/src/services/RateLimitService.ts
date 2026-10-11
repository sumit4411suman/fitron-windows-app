import type { RedisClient } from "../config/redis.js";
import { REDIS_KEYS } from "../types/index.js";

export type RateLimits = { perMinute: number; perHour: number; perDay: number; minGapMs: number; maxGapMs: number };

export type SlotResult = { ok: true } | { ok: false; retryInMs: number; reason: string };

/**
 * Per-gym send pacing, shared across worker processes through Redis: fixed windows for the minute, hour and day, plus a
 * random pause between two consecutive messages from the same gym. It never bypasses anything on WhatsApp's side; it
 * exists so a gym cannot burst and so an honest workload looks like one.
 */
export class RateLimitService {
  constructor(
    private readonly redis: RedisClient,
    private readonly limits: RateLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /** Tries to take a send slot for the gym right now. On success the counters are already incremented. */
  async acquire(gymId: string): Promise<SlotResult> {
    const t = this.now();
    const last = Number((await this.redis.get(REDIS_KEYS.lastSent(gymId))) ?? 0);
    const gap = this.limits.minGapMs + Math.floor(Math.random() * (this.limits.maxGapMs - this.limits.minGapMs + 1));
    if (last && t - last < gap) return { ok: false, retryInMs: gap - (t - last), reason: "pacing" };

    const windows = [
      { name: "minute", size: 60_000, limit: this.limits.perMinute },
      { name: "hour", size: 3_600_000, limit: this.limits.perHour },
      { name: "day", size: 86_400_000, limit: this.limits.perDay },
    ];
    const keys = windows.map((w) => ({ ...w, bucket: Math.floor(t / w.size), key: REDIS_KEYS.rate(gymId, w.name, Math.floor(t / w.size)) }));
    const counts = await Promise.all(keys.map((k) => this.redis.get(k.key).then((v) => Number(v ?? 0))));
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      if ((counts[i] ?? 0) >= k.limit) return { ok: false, retryInMs: (k.bucket + 1) * k.size - t + 250, reason: `${k.name} limit (${k.limit})` };
    }
    const multi = this.redis.multi();
    for (const k of keys) multi.incr(k.key).pexpire(k.key, k.size * 2);
    multi.set(REDIS_KEYS.lastSent(gymId), String(t), "PX", this.limits.maxGapMs * 2);
    await multi.exec();
    return { ok: true };
  }

  /** The gym's own send counts for the current windows (for status displays). */
  async usage(gymId: string): Promise<{ minute: number; hour: number; day: number }> {
    const t = this.now();
    const [m, h, d] = await Promise.all([
      this.redis.get(REDIS_KEYS.rate(gymId, "minute", Math.floor(t / 60_000))),
      this.redis.get(REDIS_KEYS.rate(gymId, "hour", Math.floor(t / 3_600_000))),
      this.redis.get(REDIS_KEYS.rate(gymId, "day", Math.floor(t / 86_400_000))),
    ]);
    return { minute: Number(m ?? 0), hour: Number(h ?? 0), day: Number(d ?? 0) };
  }
}
