import { mkdirSync } from "node:fs";
import { dataDirs, defaultDataRoot, localDatabaseUrl } from "./paths";
import { log } from "@/lib/log";
import { migrateLocal, pendingUpdate } from "./local-migrate";
import { ensureLocalSecrets } from "./local-secrets";
import { createLocalBackup, recoverDocuments } from "./fitron-backup";
import { startLocalScheduler } from "./local-scheduler";
import { stopWhenShellCloses } from "./local-shutdown";

// What the Local Edition does before serving: make the data folders, back the database up if an update will change it,
// apply pending migrations. The result is kept so
// /api/health can report it and refuse to say "ok" while the database is not ready.
export type LocalStartState = { ready: boolean; error?: string; applied: string[]; safetyBackup?: string; dataRoot: string; startedAt: string };

const g = globalThis as unknown as { fitronLocalStart?: LocalStartState };

export function localStartState(): LocalStartState | undefined {
  return g.fitronLocalStart;
}

export async function startLocalEdition(): Promise<LocalStartState> {
  const root = defaultDataRoot();
  const dirs = dataDirs(root);
  const state: LocalStartState = { ready: false, applied: [], dataRoot: root, startedAt: new Date().toISOString() };
  g.fitronLocalStart = state;
  // Started by the desktop shell: stop cleanly when FITRON closes (src/lib/runtime/local-shutdown.ts). First, so a
  // start that fails still stops when asked.
  if (process.env.FITRON_SHELL === "1") stopWhenShellCloses(localDatabaseUrl().replace(/^file:/, ""));
  try {
    // A restore that stopped half-way through swapping the documents folder: put the old one back, before anything
    // makes a new, empty documents folder.
    mkdirSync(dirs.root, { recursive: true });
    if (await recoverDocuments(dirs)) log.warn("local.start.documents_recovered");
    for (const d of [dirs.data, dirs.backups, dirs.documents, dirs.logs]) mkdirSync(d, { recursive: true });
    ensureLocalSecrets(root);
    const file = localDatabaseUrl().replace(/^file:/, "");
    // The first start after an update changes the database only after a safety backup of it (Settings › Backup lists
    // it under "safety"). If the backup cannot be made, nothing is migrated and FITRON says so.
    const pending = pendingUpdate(file);
    if (pending.length) {
      const b = await createLocalBackup({ dirs, kind: "safety", appVersion: process.env.APP_VERSION ?? "0.0.0", note: `Before updating the database (${pending.join(", ")})` });
      state.safetyBackup = b.name;
      log.info("local.start.safety_backup", { name: b.name, pending: pending.join(",") });
    }
    const r = migrateLocal(file);
    state.applied = r.applied;
    state.ready = true;
    if (process.env.FITRON_LOCAL_SCHEDULER !== "off") startLocalScheduler();
    log.info("local.start", { applied: r.applied.join(",") || null });
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    log.error("local.start.failed", e);
  }
  return state;
}
