import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

type ErrorBody = { success: false; error: { code: string; message: string; details?: unknown } };

export function toErrorBody(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) return { status: err.status, body: err.toJSON() };
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return { status: 400, body: { success: false, error: { code: "VALIDATION_ERROR", message: details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join("; "), details } } };
  }
  const e = err as { type?: string; status?: number; code?: string; message?: string };
  if (e.type === "entity.too.large" || e.code === "LIMIT_FILE_SIZE") return { status: 413, body: { success: false, error: { code: "FILE_TOO_LARGE", message: "The request body is too large." } } };
  if (e.type === "entity.parse.failed") return { status: 400, body: { success: false, error: { code: "VALIDATION_ERROR", message: "The request body is not valid JSON." } } };
  if (e.code === "LIMIT_UNEXPECTED_FILE") return { status: 400, body: { success: false, error: { code: "VALIDATION_ERROR", message: "Send the file in the multipart field named \"file\"." } } };
  if (typeof e.status === "number" && e.status >= 400 && e.status < 500) return { status: e.status, body: { success: false, error: { code: "VALIDATION_ERROR", message: e.message ?? "Bad request." } } };
  // Prisma / Redis outages become 503 so callers retry instead of treating it as a bug in their request.
  if (e.code?.startsWith("P1") || e.code === "ECONNREFUSED" || /ECONNREFUSED|Connection is closed|Can't reach database/i.test(e.message ?? "")) return { status: 503, body: { success: false, error: { code: "SERVICE_UNAVAILABLE", message: "A backing service is unavailable. Try again shortly." } } };
  return { status: 500, body: { success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong." } } };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const { status, body } = toErrorBody(err);
  if (status >= 500) logger.error({ requestId: req.requestId, path: req.path, err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err) }, "request failed");
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json(body);
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "No such endpoint." } });
}
