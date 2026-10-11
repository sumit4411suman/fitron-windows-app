import "server-only";
import { isNetworkError } from "../online";
import { SYNC_PROTOCOL, type SyncErrorBody } from "@/lib/sync/protocol";

// Cloud sync, the computer's only connection to fitron.in (docs/local-windows/SYNC.md). Off until the gym's owner links
// this computer in Settings › Cloud sync. What it sends: the gym's own records (members, plans, invoices, payments,
// expenses and the rest listed in src/lib/sync/entities.ts), to the gym's own account on fitron.in, over HTTPS, with the
// device token fitron.in issued at linking. Never another gym's, never to anyone else, never passwords or two-step
// secrets. What it receives: the same records, changed on the website.

/** fitron.in, or (development and tests only) another address given to the server. */
export function cloudUrl(env: Record<string, string | undefined> = process.env): string {
  const url = (env.FITRON_CLOUD_URL?.trim() || "https://fitron.in").replace(/\/+$/, "");
  const u = new URL(url);
  // Plain HTTP only to this computer itself (a test server); anything else must be HTTPS.
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost"))) throw new Error(`FITRON_CLOUD_URL must be an https address: ${url}`);
  return url;
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SyncHttpError";
  }
  /** Worth trying again later: no connection, a timeout, or the server's own trouble (5xx, 429). */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

const OFFLINE = "This computer could not reach fitron.in. Changes wait here and go up when the connection is back.";

export async function cloudCall<T>(base: string, path: string, o: { method?: "GET" | "POST"; token?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: o.method ?? "GET",
      headers: { ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}), ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}), "X-Fitron-Sync": String(SYNC_PROTOCOL) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
      cache: "no-store",
    });
  } catch (e) {
    if (isNetworkError(e) || (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))) throw new SyncHttpError(0, OFFLINE);
    throw e;
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const b = (json ?? {}) as Partial<SyncErrorBody>;
    throw new SyncHttpError(res.status, b.error || (res.status >= 500 ? "fitron.in had a problem. FITRON tries again shortly." : `fitron.in refused the request (${res.status}).`), b.code);
  }
  return json as T;
}

/**
 * fitron.in's change notices for the gym: calls `onSeq` with each new change number as it happens. Resolves when the
 * server ends the stream (it does so every few minutes; the caller reconnects) and rejects when it cannot be opened.
 */
export async function cloudEvents(base: string, token: string, since: number, onSeq: (seq: number) => void, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/sync/events?since=${since}`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream", "X-Fitron-Sync": String(SYNC_PROTOCOL) }, signal, cache: "no-store" });
  } catch (e) {
    if (signal.aborted) return;
    if (isNetworkError(e)) throw new SyncHttpError(0, OFFLINE);
    throw e;
  }
  if (!res.ok || !res.body) throw new SyncHttpError(res.status, `fitron.in did not open its change notices (${res.status}).`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = /^data: (\d+)$/m.exec(event)?.[1];
        if (data) onSeq(Number(data));
      }
    }
  } catch (e) {
    if (signal.aborted) return;
    throw e;
  } finally {
    reader.releaseLock();
  }
}
