import { OfflineError, offlineMessage, online, probablyOnline } from "./online";

// What every online service of FITRON for Windows answers when it cannot do its job: a reason and a sentence for the
// screen, never an exception that breaks the page. "not-configured": FITRON has not set it up for this installation;
// "offline": no internet (or the service cannot be reached); "refused": the service answered no.

export type ServiceAnswer<T> = { ok: true; data: T } | { ok: false; reason: "not-configured" | "offline" | "refused"; message: string };

/** An https base address from the environment, without a trailing slash; null when unset or not https. */
export function serviceUrl(value: string | undefined): string | null {
  const u = value?.trim();
  if (!u || !/^https:\/\/[^\s/]+/i.test(u)) return null;
  return u.replace(/\/+$/, "");
}

/**
 * One JSON request to an online service, the FITRON way: check the host first (no wait when offline), a time limit,
 * and every failure turned into an answer the screen can show.
 */
export async function askService<T>(feature: string, url: string, init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number; then?: string }): Promise<ServiceAnswer<T>> {
  const target = new URL(url);
  if (!(await probablyOnline({ host: target.hostname, port: Number(target.port || 443) }))) return { ok: false, reason: "offline", message: offlineMessage(feature, init.then) };
  try {
    return await online(
      feature,
      async () => {
        const res = await fetch(url, {
          method: init.method,
          headers: init.body === undefined ? undefined : { "content-type": "application/json" },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
        });
        const json = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
        if (!res.ok) return { ok: false as const, reason: "refused" as const, message: typeof json?.error === "string" ? json.error : `${feature} was refused (${res.status}).` };
        if (json === null) return { ok: false as const, reason: "refused" as const, message: `${feature}: the answer could not be read.` };
        return { ok: true as const, data: json as T };
      },
      init.then,
    );
  } catch (e) {
    if (e instanceof OfflineError) return { ok: false, reason: "offline", message: e.message };
    throw e;
  }
}
