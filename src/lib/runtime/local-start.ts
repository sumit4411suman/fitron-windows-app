import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { dataDirs, defaultDataRoot, localDatabaseUrl } from "./paths";
import { log } from "@/lib/log";
import { integrityCheck, migrateLocal, pendingUpdate } from "./local-migrate";
import { ensureLocalSecrets } from "./local-secrets";
import { createLocalBackup, recoverDocuments, unpackBackup, type CreatedBackup } from "./fitron-backup";
import { startLocalScheduler } from "./local-scheduler";
import { startSyncWorker } from "@/lib/sync/worker";
import { stopWhenShellCloses } from "./local-shutdown";
import { clearDamage, markDamaged, quickCheck, type Damage } from "./local-damage";

// What the Local Edition does before serving: make the data folders, back the database up if an update will change it,
// apply pending migrations. The result is kept so
// /api/health can report it and refuse to say "ok" while the database is not ready.
export type LocalStartState = { ready: boolean; error?: string; applied: string[]; safetyBackup?: string; rolledBack?: boolean; dataRoot: string; startedAt: string; damaged?: Damage };

const g = globalThis as unknown as { fitronLocalStart?: LocalStartState; fitronShellWatch?: boolean };

export function localStartState(): LocalStartState | undefined {
  return g.fitronLocalStart;
}

/** Replaces the database file with the one inside a safety backup. Only at start-up, before FITRON has opened it. */
async function putBack(safety: CreatedBackup, file: string, root: string) {
  const work = mkdtempSync(path.join(root, "rollback-"));
  try {
    await unpackBackup(safety.file, work);
    const restored = path.join(work, "data", "fitron.db");
    const check = integrityCheck(restored);
    if (!check.ok) throw new Error(`the safety backup's database failed its integrity check (${check.problems[0]})`);
    copyFileSync(restored, file);
    for (const side of ["-wal", "-shm"]) rmSync(`${file}${side}`, { force: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function startLocalEdition(): Promise<LocalStartState> {
  const root = defaultDataRoot();
  const dirs = dataDirs(root);
  const state: LocalStartState = { ready: false, applied: [], dataRoot: root, startedAt: new Date().toISOString() };
  g.fitronLocalStart = state;
  // Started by the desktop shell: stop cleanly when FITRON closes (src/lib/runtime/local-shutdown.ts). First, so a
  // start that fails still stops when asked.
  if (process.env.FITRON_SHELL === "1" && !g.fitronShellWatch) {
    g.fitronShellWatch = true;
    stopWhenShellCloses(localDatabaseUrl().replace(/^file:/, ""));
  }
  try {
    // A restore that stopped half-way through swapping the documents folder: put the old one back, before anything
    // makes a new, empty documents folder.
    mkdirSync(dirs.root, { recursive: true });
    if (await recoverDocuments(dirs)) log.warn("local.start.documents_recovered");
    for (const d of [dirs.data, dirs.backups, dirs.documents, dirs.logs]) mkdirSync(d, { recursive: true });
    ensureLocalSecrets(root);
    const file = localDatabaseUrl().replace(/^file:/, "");
    // A damaged database (a disk fault, a write the disk never finished) is found before anything opens it for work:
    // FITRON then serves only Recovery (/recovery), which restores a backup and keeps the damaged files.
    if (existsSync(file)) {
      const check = quickCheck(file);
      if (!check.ok) {
        state.damaged = markDamaged(check.problems, dirs);
        log.error("local.start.database_damaged", undefined, { problems: check.problems.slice(0, 3).join("; ") });
        return state;
      }
    }
    clearDamage(dirs);
    // The first start after an update changes the database only after a safety backup of it (Settings › Backup lists
    // it under "safety"). If the backup cannot be made, nothing is migrated and FITRON says so.
    const pending = pendingUpdate(file);
    let safety: CreatedBackup | undefined;
    if (pending.length) {
      safety = await createLocalBackup({ dirs, kind: "safety", appVersion: process.env.APP_VERSION ?? "0.0.0", note: `Before updating the database (${pending.join(", ")})` });
      state.safetyBackup = safety.name;
      log.info("local.start.safety_backup", { name: safety.name, pending: pending.join(",") });
    }
    try {
      const r = migrateLocal(file);
      // Verify the database after an update: SQLite's own integrity check, before anything is served from it.
      if (r.applied.length) {
        const check = integrityCheck(file);
        if (!check.ok) throw new Error(`the database failed its integrity check after the update (${check.problems.slice(0, 3).join("; ")})`);
      }
      state.applied = r.applied;
    } catch (e) {
      // A failed update: put the database back exactly as it was before (from the safety backup just made), so the
      // gym loses nothing, and say what to do. FITRON does not serve from a half-updated database.
      const why = e instanceof Error ? e.message : String(e);
      if (safety) {
        try {
          await putBack(safety, file, dirs.root);
          state.rolledBack = true;
          log.error("local.start.migration_failed_rolled_back", { why, backup: safety.name });
          throw new Error(
            `FITRON could not update its database to this version (${why}). The database has been put back as it was before, from the safety backup ${safety.name}, so nothing is lost. Install the previous version of FITRON again (Settings › Apps & features: uninstall FITRON, which keeps your data, then run the previous installer), or ask FITRON support.`,
          );
        } catch (rollback) {
          if (state.rolledBack) throw rollback;
          log.error("local.start.rollback_failed", rollback);
          throw new Error(`FITRON could not update its database to this version (${why}), and could not put it back by itself. Nothing has been deleted: the safety backup ${safety.name} in Settings › Backup holds everything as it was. Ask FITRON support before doing anything else.`);
        }
      }
      throw e;
    }
    state.ready = true;
    if (process.env.FITRON_LOCAL_SCHEDULER !== "off") {
      startLocalScheduler();
      // Cloud sync, when this computer is linked to fitron.in (it stops by itself when it is not).
      startSyncWorker();
    }
    log.info("local.start", { applied: state.applied.join(",") || null, safetyBackup: state.safetyBackup ?? null });
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    log.error("local.start.failed", e);
  }
  return state;
}

/**
 * After Recovery restored a backup over a damaged database: the same start as any other (the restored database is
 * already at this version and checked), then FITRON serves as usual.
 */
export async function resumeAfterRecovery(): Promise<LocalStartState> {
  const state = g.fitronLocalStart;
  if (state) state.damaged = undefined;
  return startLocalEdition();
}

