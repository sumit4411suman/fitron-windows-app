// What a WhatsApp send actually did, in the words the desk sees. Only a message the provider took is "sent". One saved
// in demo mode, queued on the linked phone, or failed (no internet, the connector closed) is never called sent.

export type Outcome = { status: string; error?: string | null } | null;

/** One send: "Payment reminder sent on WhatsApp.", "… saved, not sent: WhatsApp is not linked…", "… not sent: <why>". */
export function sendOutcome(what: string, m: Outcome, nothing = `${what} not sent.`): string {
  if (!m) return nothing;
  switch (m.status) {
    case "Failed":
      return `${what} not sent: ${m.error || "the send failed."}`;
    case "Logged":
      return `${what} saved, not sent: WhatsApp is not linked (demo mode). Link it in Settings › WhatsApp to send.`;
    case "Queued":
      return `${what} queued on the linked phone.`;
    case "Scheduled":
      return `${what} scheduled.`;
    default:
      return `${what} sent on WhatsApp.`;
  }
}

/** How to show one send's result: green only when it went (or is queued on the phone), red when it did not. */
export const outcomeTone = (m: Outcome): "ok" | "neutral" | "alert" => (!m || m.status === "Failed" ? "alert" : m.status === "Logged" ? "neutral" : "ok");

/** A batch of sends, counted by what happened to each. `skipped`: nothing was sent (reminded recently, no number). */
export type Tally = { sent: number; queued: number; logged: number; failed: number; skipped: number };
export const emptyTally = (): Tally => ({ sent: 0, queued: 0, logged: 0, failed: 0, skipped: 0 });

export function count(t: Tally, m: Outcome): Tally {
  if (!m) t.skipped++;
  else if (m.status === "Failed") t.failed++;
  else if (m.status === "Logged") t.logged++;
  else if (m.status === "Queued" || m.status === "Scheduled") t.queued++;
  else t.sent++;
  return t;
}

/**
 * An automation run's counts in words. `sent` counts every message that went through (as the run history always has);
 * `logged` (saved in demo mode) and `queued` (on the linked phone) are the part of it that did not reach WhatsApp yet.
 */
export function runCountsText(r: { sent: number; logged?: number; queued?: number }, noun = "sent"): string {
  const really = r.sent - (r.logged ?? 0) - (r.queued ?? 0);
  return [`${really} ${noun}`, r.queued ? `${r.queued} queued on the linked phone` : "", r.logged ? `${r.logged} saved, not sent (WhatsApp is not linked)` : ""].filter(Boolean).join(", ");
}

/** A batch's tone: red when any failed, plain when some were only saved (demo mode) or skipped, green when all went. */
export const tallyTone = (t: Tally): "ok" | "neutral" | "alert" => (t.failed ? "alert" : t.logged || !(t.sent + t.queued) ? "neutral" : "ok");

/** "3 reminders sent on WhatsApp · 2 not sent (failed) · 1 skipped (reminded recently or no number)." */
export function tallyText(t: Tally, noun = "reminder"): string {
  const n = (k: number) => `${k} ${noun}${k === 1 ? "" : "s"}`;
  const parts = [
    t.sent ? `${n(t.sent)} sent on WhatsApp` : "",
    t.queued ? `${n(t.queued)} queued on the linked phone` : "",
    t.logged ? `${n(t.logged)} saved, not sent (WhatsApp is not linked: demo mode)` : "",
    t.failed ? `${t.failed} not sent (failed: see WhatsApp › Failed)` : "",
    t.skipped ? `${t.skipped} skipped (reminded recently or no number)` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")}.` : `No ${noun}s to send.`;
}
