import type { PrismaClient } from "../../src/generated/prisma/index.js";
import { env, resetEnv } from "../../src/config/env.js";
import type { RedisClient } from "../../src/config/redis.js";
import { buildContainer, type Container } from "../../src/server/container.js";
import { createApp } from "../../src/server/app.js";
import { logger } from "../../src/utils/logger.js";
import { FakeDb } from "./fakeDb.js";
import { FakeQueue } from "./fakeQueue.js";
import { FakeRedisHub } from "./fakeRedis.js";

export type TestWorld = { c: Container; app: ReturnType<typeof createApp>; db: FakeDb; hub: FakeRedisHub; queue: FakeQueue; masterKey: string };

/** The whole API wired to fakes. */
export function testWorld(overrides: Partial<Record<string, string>> = {}): TestWorld {
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  resetEnv();
  const e = env();
  const db = new FakeDb();
  const hub = new FakeRedisHub();
  const queue = new FakeQueue();
  const c = buildContainer({ env: e, db: db as unknown as PrismaClient, redis: hub.client() as unknown as RedisClient, subscriber: hub.client() as unknown as RedisClient, queue, logger });
  return { c, app: createApp(c), db, hub, queue, masterKey: e.WA_CONNECTOR_MASTER_KEY };
}

/** Creates a gym through the admin API and returns its key. */
export async function makeGym(w: TestWorld, name = "Iron Gym", extra: Record<string, unknown> = {}): Promise<{ gymId: string; apiKey: string }> {
  const { default: request } = await import("supertest");
  const res = await request(w.app).post("/api/v1/gyms").set("Authorization", `Bearer ${w.masterKey}`).send({ name, ...extra });
  if (res.status !== 201) throw new Error(`gym create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { gymId: res.body.data.gymId, apiKey: res.body.data.apiKey };
}

/** Marks the gym's session CONNECTED in the store (what the worker would do after a scan). */
export async function connectGym(w: TestWorld, gymId: string, phone = "919999900000"): Promise<void> {
  await w.c.sessions.store.setStatus(gymId, "CONNECTED", { phoneNumber: phone, sessionLocation: gymId });
  await w.hub.client().set("wa:worker:heartbeat", "1", "EX", 20);
}
