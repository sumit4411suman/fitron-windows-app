import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { cloudEvents, cloudUrl, SyncHttpError } from "@/lib/integrations/sync";
import { readState, syncOnce, tokenOf, trimUploaded, type RoundResult } from "./client";

// Cloud sync's background worker on the computer, started with the server (src/lib/runtime/local-start.ts) and stopped
// when FITRON closes. It never makes the desk wait:
//   - a round (upload, then download) every 10 seconds while changes are waiting here, otherwise every minute;
//   - at once when fitron.in announces a change (Server-Sent Events, reconnected whenever the stream ends);
//   - after a failure, again in 5 s, 10 s, 20 s… up to 10 minutes (with jitter), so an offline computer costs nothing;
//   - not at all once fitron.in has said the computer is no longer linked (until the owner links it again).

type Worker = {
  timer: NodeJS.Timeout | null;
  running: boolean;
  again: boolean;
  failures: number;
  stopped: boolean;
  revoked: boolean;
  events: AbortController | null;
  last: { at: Date; result?: RoundResult; error?: string } | null;
  trimmedAt: number;
};

const g = globalThis as unknown as { fitronSync?: Worker; fitronStopping?: boolean };

const BUSY_MS = 10_000;
const IDLE_MS = 60_000;
const MAX_BACKOFF_MS = 600_000;
/** Uploaded changes older than 30 days are dropped here at most once a day, after a round with nothing waiting. */
const TRIM_EVERY_MS = 86_400_000;

export const backoffMs = (failures: number, rand = Math.random()) => Math.round(Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.max(0, failures - 1)) * (0.8 + rand * 0.4));

const w = (): Worker => (g.fitronSync ??= { timer: null, running: false, again: false, failures: 0, stopped: true, revoked: false, events: null, last: null, trimmedAt: 0 });

function schedule(ms: number) {
  const s = w();
  if (s.stopped) return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => void tick(), ms);
  s.timer.unref?.();
}

async function tick() {
  const s = w();
  if (s.stopped || g.fitronStopping) return;
  if (s.running) {
    s.again = true;
    return;
  }
  s.running = true;
  let next = IDLE_MS;
  try {
    const state = await readState();
    if (!state?.linked) {
      stopSyncWorker();
      return;
    }
    const result = await syncOnce(state.cloudUrl || cloudUrl());
    s.failures = 0;
    s.last = { at: new Date(), result: result ?? undefined };
    if ((await db.syncChange.count({ where: { status: "PENDING" } })) > 0) next = BUSY_MS;
    else if (Date.now() - s.trimmedAt > TRIM_EVERY_MS) {
      s.trimmedAt = Date.now();
      await trimUploaded().catch((e) => log.warn("sync.trim_failed", e));
    }
    ensureEvents();
  } catch (e) {
    s.failures++;
    s.last = { at: new Date(), error: e instanceof Error ? e.message : String(e) };
    if (e instanceof SyncHttpError && e.status === 401) {
      // fitron.in no longer knows this computer (unlinked there). Changes keep being recorded here; nothing is sent.
      s.revoked = true;
      log.warn("sync.revoked", e);
      stopSyncWorker();
      return;
    }
    if (!(e instanceof SyncHttpError)) log.error("sync.round_failed", e);
    next = backoffMs(s.failures);
  } finally {
    s.running = false;
  }
  if (s.again) {
    s.again = false;
    next = 500;
  }
  schedule(next);
}

/** Listens for fitron.in's change notices while the worker runs; each one brings a round forward. */
function ensureEvents() {
  const s = w();
  if (s.events || s.stopped) return;
  const ctrl = new AbortController();
  s.events = ctrl;
  void (async () => {
    let failures = 0;
    while (!ctrl.signal.aborted && !s.stopped && !g.fitronStopping) {
      const state = await readState().catch(() => null);
      if (!state?.linked) break;
      try {
        await cloudEvents(state.cloudUrl || cloudUrl(), tokenOf(state), Number(state.appliedSeq), (seq) => {
          if (seq > Number(state.appliedSeq)) syncSoon();
        }, ctrl.signal);
        failures = 0;
      } catch {
        failures++;
      }
      if (ctrl.signal.aborted) break;
      await new Promise((r) => setTimeout(r, failures ? backoffMs(failures) : 1_000).unref?.());
    }
    if (s.events === ctrl) s.events = null;
  })();
}

/** Starts the worker (once per server). The first round runs a few seconds after FITRON opens. */
export function startSyncWorker(firstInMs = 5_000) {
  const s = w();
  s.stopped = false;
  s.revoked = false;
  s.failures = 0;
  schedule(firstInMs);
}

export function stopSyncWorker() {
  const s = w();
  s.stopped = true;
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  s.events?.abort();
  s.events = null;
}

/** A round as soon as possible (a change notice, or the owner's "Sync now"). */
export function syncSoon(ms = 500) {
  if (!w().stopped) schedule(ms);
}

/** "Sync now": one round, waited for, with its answer for the screen. */
export async function syncNow(): Promise<RoundResult | null> {
  const state = await readState();
  if (!state?.linked) return null;
  const result = await syncOnce(state.cloudUrl || cloudUrl());
  const s = w();
  s.failures = 0;
  s.last = { at: new Date(), result: result ?? undefined };
  if (s.stopped && !s.revoked) startSyncWorker(IDLE_MS);
  return result;
}

export const workerStatus = () => {
  const s = w();
  return { running: s.running, stopped: s.stopped, revoked: s.revoked, failures: s.failures, last: s.last };
};
