import { mkdirSync } from "node:fs";
import { dataDirs, defaultDataRoot, localDatabaseUrl } from "./paths";
import { migrateLocal } from "./local-migrate";

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
    const file = localDatabaseUrl().replace(/^file:/, "");
    const r = migrateLocal(file);
    state.applied = r.applied;
    state.ready = true;
    if (r.applied.length) console.log(`[fitron-local] applied migrations: ${r.applied.join(", ")}`);
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    console.error(`[fitron-local] start failed: ${state.error}`);
  }
  return state;
}
