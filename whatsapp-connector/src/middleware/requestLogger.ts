import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger.js";

/** One structured line per request: method, path, status, duration, who. Never bodies, never query strings with data. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  req.requestId = (req.headers["x-request-id"] as string | undefined)?.slice(0, 64) ?? randomUUID();
  res.setHeader("x-request-id", req.requestId);
  res.on("finish", () => {
    if (req.originalUrl === "/health" || req.originalUrl === "/ready") return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const p = req.principal;
    logger.info({ requestId: req.requestId, method: req.method, path: req.originalUrl.split("?")[0], status: res.statusCode, ms: Math.round(ms), gymId: p?.kind === "gym" ? p.gymId : undefined, master: p?.kind === "master" || undefined }, "request");
  });
  next();
}
