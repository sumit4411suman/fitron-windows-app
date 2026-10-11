import { log } from "@/lib/log";
import { createLocalBackup, listLocalBackups, pruneLocalBackups } from "./fitron-backup";
import { readLocalSettings } from "./local-settings";
import { dataDirs } from "./paths";

// The Local Edition's own timer. A hosted server has a scheduler calling /api/jobs/daily; a laptop has nobody, and is
// off at night. So FITRON checks shortly after it starts and then every hour while it is open, and does what is due:
// the automatic backup (once a day, newest 14 kept), then the gym's daily jobs (each once a day: churn risk, reminders,
// lead follow-ups, retention…; one that needs the internet waits for it) and messages held by quiet hours.

const HOUR = 60 * 60_000;
const DUE_AFTER = 23 * HOUR;
const g = globalThis as unknown as { fitronScheduler?: NodeJS.Timeout; fitronAutoBackupRunning?: boolean; fitronJobsRunning?: boolean };

export async function autoBackupIfDue(now = new Date()): Promise<"done" | "not-due" | "off" | "busy"> {
  const s = readLocalSettings();
  if (!s.autoBackup) return "off";
  if (g.fitronAutoBackupRunning) return "busy";
  const last = (await listLocalBackups()).find((b) => b.kind === "auto");
  if (last && now.getTime() - last.modifiedAt.getTime() < DUE_AFTER) return "not-due";
  g.fitronAutoBackupRunning = true;
  try {
    const b = await createLocalBackup({ dirs: dataDirs(), kind: "auto", appVersion: process.env.APP_VERSION ?? "0.0.0", now });
    const removed = await pruneLocalBackups("auto", s.keepAutoBackups);
    log.info("local.backup.auto", { name: b.name, size: b.size, removed: removed.length });
    return "done";
  } catch (e) {
    log.error("local.backup.auto_failed", e);
    throw e;
  } finally {
    g.fitronAutoBackupRunning = false;
  }
}

/** The gym's daily jobs that are still due today, and held messages. One pass at a time. */
export async function localJobsIfDue(now = new Date()): Promise<"done" | "busy"> {
  if (g.fitronJobsRunning) return "busy";
  g.fitronJobsRunning = true;
  try {
    // Loaded here, not at the top: this file starts before the database is migrated (src/lib/runtime/local-start.ts).
    const { runDueOnThisComputer } = await import("@/lib/services/jobs");
    const r = await runDueOnThisComputer(now);
    if (r.ran || r.waiting) log.info("local.jobs", r);
    return "done";
  } catch (e) {
    log.error("local.jobs_failed", e);
    throw e;
  } finally {
    g.fitronJobsRunning = false;
  }
}

export function startLocalScheduler() {
  if (g.fitronScheduler) return;
  // The backup first, so the day's jobs never run on data that has not been backed up yet today.
  const tick = () =>
    void autoBackupIfDue()
      .catch(() => {})
      .then(() => localJobsIfDue())
      .catch(() => {});
  // A couple of minutes after start, so opening FITRON is never slowed down by a backup.
  setTimeout(tick, 2 * 60_000).unref();
  g.fitronScheduler = setInterval(tick, HOUR);
  g.fitronScheduler.unref();
}
