import { Router } from "express";
import type { Container } from "../../server/container.js";

type Probe = "connected" | "disconnected";

async function probeDb(c: Container): Promise<Probe> {
  try {
    await c.db.$queryRaw`SELECT 1`;
    return "connected";
  } catch {
    return "disconnected";
  }
}
async function probeRedis(c: Container): Promise<Probe> {
  try {
    return (await c.redis.ping()) === "PONG" ? "connected" : "disconnected";
  } catch {
    return "disconnected";
  }
}

/** /health for monitoring, /ready for orchestrators. Both are unauthenticated and say nothing about any gym. */
export function healthRoutes(c: Container): Router {
  const r = Router();
  r.get("/health", async (_req, res) => {
    const [database, redis, whatsapp] = await Promise.all([probeDb(c), probeRedis(c), c.whatsappRunning().catch(() => false)]);
    const healthy = database === "connected" && redis === "connected";
    res.status(healthy ? 200 : 503).json({ status: healthy ? (whatsapp ? "healthy" : "degraded") : "unhealthy", database, redis, whatsapp: whatsapp ? "running" : "stopped", version: process.env.npm_package_version ?? "1.0.0", uptime: Math.round(process.uptime()) });
  });
  r.get("/ready", async (_req, res) => {
    const [database, redis] = await Promise.all([probeDb(c), probeRedis(c)]);
    const ready = database === "connected" && redis === "connected";
    res.status(ready ? 200 : 503).json({ ready, database, redis });
  });
  return r;
}
