import { emailReady, sendEmail } from "@/lib/integrations/email";
import { errorFields, log, type Fields } from "@/lib/log";
import { UserError } from "@/lib/services/errors";

// What happens to an error nobody caught: Next.js hands it to onRequestError (src/instrumentation.ts), which lands
// here. It is written to the log with the error's digest (the reference the visitor sees on the error page) and the
// request's id, and, when ERROR_ALERT_TO is set, emailed to the owner, once per kind of error per hour.

export type RequestInfo = { path: string; method: string; headers: Record<string, string | string[] | undefined> };
export type ErrorContext = { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string; renderType?: string };

/** Errors that are part of normal flow, not faults: redirects, "not found", and rules shown to the user. */
export function isExpected(err: unknown): boolean {
  if (err instanceof UserError) return true;
  const digest = typeof err === "object" && err !== null ? (err as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(digest);
}

/** The id the proxy in front of the app gave this request (deploy/Caddyfile), cleaned up since a visitor could send one. */
const requestId = (h: RequestInfo["headers"]) => {
  const v = h["x-request-id"];
  const id = (Array.isArray(v) ? v[0] : v)?.replace(/[^\w.-]/g, "").slice(0, 64);
  return id || undefined;
};

/** Everything worth knowing about a failed request, without its query string (it can hold sign-in tokens) or its body. */
export function describeRequestError(err: unknown, request: RequestInfo, context: ErrorContext): Fields {
  return {
    ...errorFields(err),
    requestId: requestId(request.headers),
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  };
}

/** Emails and long numbers out of a message before it is sent anywhere. */
export const scrub = (s: string) => s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]").replace(/\d[\d\s-]{6,}\d/g, "[number]");

/**
 * Decides which errors are emailed: an error of the same kind is sent at most once per window, with a count of how many
 * were held back since, and no more than `maxPerWindow` emails go out in a window whatever the errors are, so a broken
 * page that every visitor hits cannot fill the owner's inbox. Kept in memory: one server, like the rate limiter.
 */
export class AlertThrottle {
  private seen = new Map<string, { at: number; skipped: number }>();
  private sent: number[] = [];

  constructor(
    private windowMs = 60 * 60_000,
    private maxPerWindow = 10,
    private maxKinds = 500,
  ) {}

  /** null: don't email this one. Otherwise: email it, and say how many like it were held back since the last email. */
  take(kind: string, now = Date.now()): { skipped: number } | null {
    this.sent = this.sent.filter((t) => now - t < this.windowMs);
    const prev = this.seen.get(kind);
    if (prev && now - prev.at < this.windowMs) {
      prev.skipped += 1;
      return null;
    }
    if (this.sent.length >= this.maxPerWindow) return null;
    this.sent.push(now);
    this.seen.delete(kind);
    this.seen.set(kind, { at: now, skipped: prev?.skipped ?? 0 });
    if (this.seen.size > this.maxKinds) this.seen.delete(this.seen.keys().next().value!);
    return { skipped: prev?.skipped ?? 0 };
  }
}

const throttle = new AlertThrottle();

export function alertText(f: Fields, skipped: number, now = new Date()): string {
  const where = [f.method, f.path].filter(Boolean).join(" ");
  return [
    "Something failed on the FITRON server and nobody caught it.",
    "",
    `When: ${now.toISOString()}`,
    `Where: ${where || "unknown"}${f.routePath ? ` (route ${f.routePath}${f.routeType ? `, ${f.routeType}` : ""})` : ""}`,
    `Error: ${f.errorName ?? "Error"}: ${scrub(String(f.errorMessage ?? "no message"))}`,
    f.digest ? `Reference: ${f.digest}` : "",
    f.requestId ? `Request id: ${f.requestId}` : "",
    skipped ? `${skipped} more like it since the last email.` : "",
    `Version: ${[process.env.APP_VERSION, process.env.APP_COMMIT].filter(Boolean).join(" ")}`,
    "",
    "Find it in the server log:",
    `  docker compose logs app | grep ${f.digest ? `"${f.digest}"` : "request.error"}`,
    "",
    "At most one email per kind of error per hour is sent.",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

async function alert(f: Fields) {
  const to = process.env.ERROR_ALERT_TO?.split(",").map((s) => s.trim()).filter(Boolean).join(",");
  if (!to || process.env.NODE_ENV !== "production" || !emailReady()) return;
  const kind = `${f.routePath}|${f.errorName}|${scrub(String(f.errorMessage ?? "")).slice(0, 80)}`;
  const slot = throttle.take(kind);
  if (!slot) return;
  await sendEmail({ to, subject: `[FITRON] Error on ${f.routePath ?? f.path ?? "the server"}`, text: alertText(f, slot.skipped) });
}

/** Called for every error Next.js catches in a page, action or route. Never throws: reporting must not cause a second failure. */
export async function reportRequestError(err: unknown, request: RequestInfo, context: ErrorContext) {
  try {
    if (isExpected(err)) return;
    const fields = describeRequestError(err, request, context);
    log.error("request.error", undefined, fields);
    await alert(fields).catch((e) => log.warn("request.error.alert_failed", e));
  } catch (e) {
    log.warn("request.error.report_failed", e);
  }
}
