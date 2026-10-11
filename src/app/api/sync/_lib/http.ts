import "server-only";
import { isLocal } from "@/lib/runtime/edition";
import { rateLimit } from "@/lib/rate-limit";
import { UserError } from "@/lib/services/errors";
import { log } from "@/lib/log";
import { authDevice, type DeviceAuth } from "@/lib/sync/server";
import { SYNC_PROTOCOL, type SyncErrorBody } from "@/lib/sync/protocol";

// The fitron.in end of cloud sync. Machine routes: a computer authenticates with its device token (no session), so they
// sit outside the proxy (src/lib/public-paths.ts) and check everything themselves. FITRON for Windows has none of them.

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
export const fail = (error: string, status: number, code?: SyncErrorBody["code"]) => json({ error, ...(code ? { code } : {}) } satisfies SyncErrorBody, status);

const ip = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

/** The checks every sync request passes first: this is fitron.in, the computer speaks this protocol, and not too often. */
function gate(req: Request, limit: { key: string; n: number; ms: number }): Response | null {
  if (isLocal()) return new Response("Not part of FITRON for Windows.", { status: 404 });
  const v = req.headers.get("x-fitron-sync");
  if (v !== String(SYNC_PROTOCOL)) return fail("This version of FITRON for Windows cannot sync with fitron.in. Update FITRON.", 426, "protocol");
  if (!rateLimit(`${limit.key}:${ip(req)}`, limit.n, limit.ms)) return fail("Too many requests. FITRON tries again shortly.", 429);
  return null;
}

/** A request from a linked computer: runs `fn` with the device, or answers 401 when the token is not (or no longer) valid. */
export async function withDevice(req: Request, fn: (dev: DeviceAuth) => Promise<Response>, limit = { n: 240, ms: 60_000 }): Promise<Response> {
  const stop = gate(req, { key: "sync", ...limit });
  if (stop) return stop;
  const dev = await authDevice(req.headers.get("authorization"));
  if (!dev) return fail("This computer is not linked to fitron.in any more. Link it again in Settings › Cloud sync.", 401, "unlinked");
  return guarded(fn.bind(null, dev));
}

/** A request with the owner's fitron.in password (linking): stricter limits. */
export async function withPassword(req: Request, fn: () => Promise<Response>): Promise<Response> {
  const stop = gate(req, { key: "sync-link", n: 10, ms: 10 * 60_000 });
  return stop ?? guarded(fn);
}

async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserError) return fail(e.message, 400, e.field === "two-step" ? "two-step" : undefined);
    log.error("sync.request_failed", e);
    return fail("fitron.in had a problem. FITRON tries again shortly.", 500);
  }
}

export async function readJson<T>(req: Request, max = 8_000_000): Promise<T | null> {
  const text = await req.text();
  if (text.length > max) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
