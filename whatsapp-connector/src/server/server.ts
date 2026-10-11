import type { Server } from "node:http";
import { env } from "../config/env.js";
import { disconnectPrisma } from "../config/database.js";
import { disconnectRedis } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import { createApp } from "./app.js";
import { createContainer } from "./container.js";
import { startWorker, type WorkerRuntime } from "./worker.js";

/**
 * Entry point. RUN_MODE=api serves HTTP only, RUN_MODE=worker owns the WhatsApp sessions and the queue, RUN_MODE=all does
 * both in one process. In every mode a small HTTP server answers /health and /ready.
 */
export async function main(): Promise<void> {
  const e = env();
  const c = createContainer();
  let worker: WorkerRuntime | null = null;
  let server: Server | null = null;

  const app = createApp(c);
  if (e.RUN_MODE === "worker") {
    // The worker exposes health only; nginx routes the API to the api service.
    const { default: express } = await import("express");
    const { healthRoutes } = await import("../api/health/routes.js");
    const w = express();
    w.disable("x-powered-by");
    w.use(healthRoutes({ ...c, whatsappRunning: async () => worker?.manager.hasLock ?? false }));
    server = w.listen(e.PORT, e.HOST, () => logger.info({ port: e.PORT, mode: e.RUN_MODE }, "worker health endpoint listening"));
  } else {
    server = app.listen(e.PORT, e.HOST, () => logger.info({ port: e.PORT, mode: e.RUN_MODE }, "api listening"));
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 70_000;
  }

  if (e.RUN_MODE !== "api") {
    try {
      worker = await startWorker(c);
    } catch (err) {
      logger.fatal({ err: (err as Error).message }, "worker failed to start");
      process.exit(1);
    }
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    const deadline = setTimeout(() => {
      logger.error("shutdown timed out; exiting");
      process.exit(1);
    }, 25_000);
    deadline.unref();
    try {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      if (worker) await worker.stop();
      await c.close();
      await disconnectRedis();
      await disconnectPrisma();
      logger.info("bye");
      process.exit(0);
    } catch (err) {
      logger.error({ err: (err as Error).message }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => logger.error({ err: reason instanceof Error ? reason.message : String(reason) }, "unhandled rejection"));
  process.on("uncaughtException", (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, "uncaught exception");
    void shutdown("uncaughtException");
  });
}

const isMain = process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts");
if (isMain) {
  main().catch((err: Error) => {
    logger.fatal({ err: err.message }, "failed to start");
    process.exit(1);
  });
}
