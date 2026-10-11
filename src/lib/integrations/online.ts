import { connect } from "node:net";
import { UserError } from "@/lib/services/errors";
import { offlineMessage } from "@/lib/domain/offline";

// Online services (WhatsApp, email, AI, Razorpay, licence, updates) behind one rule: a feature that needs the internet
// says so in words when there is none, instead of an error page, a raw "fetch failed" or a long wait. Gym Accounting
// itself never needs this: it works on the computer's own database.

export { OFFLINE_MESSAGE, offlineMessage } from "@/lib/domain/offline";

/** A feature could not reach its online service. A UserError, so the console shows its message as a normal notice. */
export class OfflineError extends UserError {}

/** The connection error codes Node gives when there is no network, or the other side cannot be reached. */
const NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT", "ECONNRESET", "EPIPE", "ESOCKET", "ECONNECTION", "EDNS", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT"]);

/** Whether an error means "could not reach the service" (no internet, DNS, refused, timed out), not "the service said no". */
export function isNetworkError(e: unknown): boolean {
  for (let x = e as { code?: unknown; cause?: unknown; name?: unknown; message?: unknown } | undefined, depth = 0; x && depth < 5; x = x.cause as typeof x, depth++) {
    if (x instanceof OfflineError) return true;
    if (typeof x.code === "string" && NETWORK_CODES.has(x.code)) return true;
    if (x.name === "TimeoutError" || x.name === "AbortError") return true;
    if (typeof x.message === "string" && /fetch failed|getaddrinfo|socket hang up|network/i.test(x.message)) return true;
  }
  return false;
}

/**
 * Runs an online call. A network failure becomes an OfflineError with the offline message, which the console shows as
 * a normal notice. Any other error (a refused key, a bad request) is left as it is: it is not "offline".
 */
export async function online<T>(feature: string, call: () => Promise<T>, then?: string): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (isNetworkError(e)) throw new OfflineError(offlineMessage(feature, then));
    throw e;
  }
}

/** The online services FITRON talks to, for `probablyOnline`. Email's host is the gym's own mail server (SMTP_HOST). */
export const SERVICE = {
  fitron: { host: "fitron.in", port: 443 },
  razorpay: { host: "api.razorpay.com", port: 443 },
  meta: { host: "graph.facebook.com", port: 443 },
  anthropic: { host: "api.anthropic.com", port: 443 },
} as const;
type Target = { host: string; port: number };

const g = globalThis as unknown as { fitronOnline?: Map<string, { at: number; up: Promise<boolean> }> };

/** Opens and closes one connection, or gives up after `ms`. True when it connected. Tries IPv4 and IPv6 in turn. */
function reaches(t: Target, ms: number): Promise<boolean> {
  return new Promise((done) => {
    const s = connect({ host: t.host, port: t.port, autoSelectFamily: true });
    const timer = setTimeout(() => end(false), ms).unref();
    function end(up: boolean) {
      clearTimeout(timer);
      s.destroy();
      done(up);
    }
    s.once("connect", () => end(true));
    s.once("error", () => end(false));
  });
}

const isLoopback = (h: string) => h === "localhost" || h === "::1" || /^127\./.test(h);

/**
 * A quick guess at whether a service can be reached, for features that want to say "offline" before anyone waits:
 * one connection to the host the feature will use (a mail server on the gym's own network counts; a name the computer
 * still remembers does not), answered within 1.5 seconds and remembered for 30 seconds per host. Never used to decide
 * whether core work may happen; only to word the online features.
 */
export function probablyOnline(target: Target = SERVICE.fitron, now = Date.now()): Promise<boolean> {
  if (isLoopback(target.host)) return Promise.resolve(true);
  const cache = (g.fitronOnline ??= new Map());
  const key = `${target.host}:${target.port}`;
  const c = cache.get(key);
  if (c && now - c.at < 30_000) return c.up;
  const up = reaches(target, 1_500);
  cache.set(key, { at: now, up });
  return up;
}
