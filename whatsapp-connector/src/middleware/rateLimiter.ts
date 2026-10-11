import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Request } from "express";

/** HTTP-level limit per API key (or IP before authentication). This protects the API; message pacing is separate. */
export function apiRateLimiter(perMinute: number) {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const auth = req.headers.authorization;
      // The key itself is never used as a Redis/memory key in clear: a short digest is enough to tell callers apart.
      return auth ? `k:${Buffer.from(auth).toString("base64url").slice(-24)}` : `ip:${ipKeyGenerator(req.ip ?? "")}`;
    },
    skip: (req) => req.path === "/health" || req.path === "/ready" || req.path.endsWith("/whatsapp/events"),
    handler: (_req, res) => {
      res.status(429).json({ success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests. Slow down." } });
    },
  });
}

/** Tighter limit for authentication-sensitive admin endpoints. */
export function adminRateLimiter() {
  return rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: (req) => `admin:${ipKeyGenerator(req.ip ?? "")}`, handler: (_req, res) => res.status(429).json({ success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests." } }) });
}
