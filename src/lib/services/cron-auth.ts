import "server-only";
import { timingSafeEqual } from "node:crypto";

/** A scheduler's call to /api/jobs/*: "Authorization: Bearer $CRON_SECRET". */
export function cronAuthorised(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
