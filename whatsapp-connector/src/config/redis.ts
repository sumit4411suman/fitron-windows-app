import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

// Redis connections. BullMQ needs maxRetriesPerRequest: null on the connections it is given; subscribers need a
// connection of their own because a subscribed connection cannot run commands.

export type RedisClient = Redis;

export function createRedis(name: string): RedisClient {
  const r = new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    connectionName: `wa-connector:${name}`,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });
  r.on("error", (err) => logger.warn({ err: err.message, name }, "redis error"));
  return r;
}

let shared: RedisClient | null = null;

/** The process-wide connection for commands (counters, locks, pub). */
export function redis(): RedisClient {
  if (!shared) shared = createRedis("main");
  return shared;
}

export function setRedis(r: RedisClient | null): void {
  shared = r;
}

export async function disconnectRedis(): Promise<void> {
  if (shared) {
    await shared.quit().catch(() => undefined);
    shared = null;
  }
}
