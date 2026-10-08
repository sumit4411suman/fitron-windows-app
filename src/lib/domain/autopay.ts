import { addDays } from "./dates";
import { fmtDate } from "@/lib/format";

export const DEBIT_REASONS = ["Insufficient balance", "Bank declined the debit", "UPI app did not respond"] as const;

/** The prototype's deterministic pseudo-random number in [0, 1). */
export function seed(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

export type DebitOutcome = { ok: true } | { ok: false; reason: string; retries: number; halted: boolean; nextRetryOn: string | null; lastResult: string };

/** Demo mode's simulated UPI debit (prototype A.debit): 85% succeed; failures retry `retryGap` days apart, then halt. */
export function simulateDebit(a: { mandateId: string; today: string; retries: number; maxRetries: number; retryGap: number; roll?: number }): DebitOutcome {
  const roll = a.roll ?? seed(a.mandateId + a.today + a.retries);
  if (roll < 0.85) return { ok: true };
  const r = a.retries + 1;
  const reason = DEBIT_REASONS[Math.floor(seed(a.mandateId + a.today + "why") * 3)]!;
  if (r > a.maxRetries) return { ok: false, reason, retries: r, halted: true, nextRetryOn: null, lastResult: `${reason} · ${a.maxRetries} retries used` };
  const nextRetryOn = addDays(a.today, a.retryGap);
  return { ok: false, reason, retries: r, halted: false, nextRetryOn, lastResult: `${reason} · retry ${r} of ${a.maxRetries} on ${fmtDate(nextRetryOn)}` };
}
