import { mkdirSync } from "node:fs";
import { dataDirs, defaultDataRoot, localDatabaseUrl } from "./paths";
import { log } from "@/lib/log";
import { migrateLocal } from "./local-migrate";
import { ensureLocalSecrets } from "./local-secrets";

// What the Local Edition does before serving: make the data folders, apply pending migrations. The result is kept so
// /api/health can report it and refuse to say "ok" while the database is not ready.
export type LocalStartState = { ready: boolean; error?: string; applied: string[]; dataRoot: string; startedAt: string };

const g = globalThis as unknown as { fitronLocalStart?: LocalStartState };

export function localStartState(): LocalStartState | undefined {
  return g.fitronLocalStart;
}

export async function startLocalEdition(): Promise<LocalStartState> {
  const root = defaultDataRoot();
  const dirs = dataDirs(root);
  const state: LocalStartState = { ready: false, applied: [], dataRoot: root, startedAt: new Date().toISOString() };
  g.fitronLocalStart = state;
  try {
    for (const d of [dirs.data, dirs.backups, dirs.documents, dirs.logs]) mkdirSync(d, { recursive: true });
    ensureLocalSecrets(root);
    const file = localDatabaseUrl().replace(/^file:/, "");
    const r = migrateLocal(file);
    state.applied = r.applied;
    state.ready = true;
    log.info("local.start", { applied: r.applied.join(",") || null });
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    log.error("local.start.failed", e);
  }
  return state;
}
