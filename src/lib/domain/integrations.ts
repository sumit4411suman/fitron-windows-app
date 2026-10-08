import { fmtStamp, fmtTime } from "@/lib/format";

// Settings › Integrations & AI: pure text and defaults (prototype set.isInt, fitron-core defaults).

export type AutopaySettings = {
  mode: "demo" | "live";
  /** How many times a failed demo debit is retried before the mandate halts (1–10). */
  retries: number;
  /** Days between those retries (1–30). */
  retryGap: number;
  /** The last "Test connection" result; absent until the first check. */
  connOk?: boolean;
  webhookOk?: boolean;
  keyId?: string;
  error?: string;
  checkedAt?: string;
  /** The last "Sync with Razorpay" (ISO instant) and what it found. */
  lastSyncAt?: string;
  lastSync?: { checked: number; charged: number; changed: number; applied: number; errors: number; error?: string };
};

export const DEFAULT_AUTOPAY: AutopaySettings = { mode: "demo", retries: 3, retryGap: 2 };

export const withAutopayDefaults = (row: Partial<AutopaySettings> | null | undefined): AutopaySettings => ({
  ...DEFAULT_AUTOPAY,
  ...(row ?? {}),
  mode: row?.mode === "live" ? "live" : "demo",
  retries: clampInt(row?.retries, 1, 10, DEFAULT_AUTOPAY.retries),
  retryGap: clampInt(row?.retryGap, 1, 30, DEFAULT_AUTOPAY.retryGap),
});

function clampInt(v: unknown, min: number, max: number, dflt: number) {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.max(min, Math.min(max, n));
}

/** The status line under "Test connection". */
export function autopayStatusText(s: Pick<AutopaySettings, "connOk" | "webhookOk" | "error" | "checkedAt">, mode: "demo" | "live") {
  if (mode === "demo") return "Demo mode: debits are simulated inside Fitron. Nothing to test.";
  if (s.connOk === undefined) return "Not checked yet";
  const checked = s.checkedAt ? ` · checked ${fmtStamp(new Date(s.checkedAt))}, ${fmtTime(new Date(s.checkedAt))}` : "";
  if (s.connOk) return `Razorpay reachable · keys set · webhook secret ${s.webhookOk ? "set" : "missing"}${checked}`;
  return `Razorpay not reachable: ${s.error ?? "unknown error"}${checked}`;
}

/** Check-in devices panel: one line per device. Online means seen in the last 5 minutes. */
export function deviceStatusText(d: { lastSeenAt: Date | string | null | undefined }, now: Date = new Date()) {
  if (!d.lastSeenAt) return "Waiting for first connection";
  const seen = new Date(d.lastSeenAt);
  const mins = Math.floor((now.getTime() - seen.getTime()) / 60_000);
  if (mins < 5) return mins < 1 ? "Online · last sync just now" : `Online · last sync ${mins} min ago`;
  return `Offline · last seen ${fmtStamp(seen)}, ${fmtTime(seen)}`;
}

export type AiSettings = { enabled: boolean; dailyBrief: boolean; autoWinback: boolean };
export const DEFAULT_AI: AiSettings = { enabled: true, dailyBrief: true, autoWinback: false };

export const withAiDefaults = (row: Partial<AiSettings> | null | undefined): AiSettings => ({
  enabled: typeof row?.enabled === "boolean" ? row.enabled : DEFAULT_AI.enabled,
  dailyBrief: typeof row?.dailyBrief === "boolean" ? row.dailyBrief : DEFAULT_AI.dailyBrief,
  autoWinback: typeof row?.autoWinback === "boolean" ? row.autoWinback : DEFAULT_AI.autoWinback,
});
