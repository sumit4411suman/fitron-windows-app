import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDirs } from "./paths";

// Settings of this installation, not of a gym: kept in <data>\settings.json, beside the database rather than in it, so
// a restore does not change them (the automatic backup must keep running after restoring an old backup).
export type LocalSettings = { autoBackup: boolean; keepAutoBackups: number; keepSafetyBackups: number };
export const DEFAULT_LOCAL_SETTINGS: LocalSettings = { autoBackup: true, keepAutoBackups: 14, keepSafetyBackups: 10 };

const file = (root = dataDirs().root) => path.join(root, "settings.json");

export function readLocalSettings(root?: string): LocalSettings {
  try {
    if (existsSync(file(root))) return { ...DEFAULT_LOCAL_SETTINGS, ...(JSON.parse(readFileSync(file(root), "utf8")) as Partial<LocalSettings>) };
  } catch {
    // A damaged settings file falls back to the defaults (backups on), never to "off".
  }
  return { ...DEFAULT_LOCAL_SETTINGS };
}

export function writeLocalSettings(patch: Partial<LocalSettings>, root?: string): LocalSettings {
  const next = { ...readLocalSettings(root), ...patch };
  next.keepAutoBackups = Math.max(1, Math.min(365, Math.floor(next.keepAutoBackups)));
  next.keepSafetyBackups = Math.max(1, Math.min(100, Math.floor(next.keepSafetyBackups)));
  const f = file(root);
  writeFileSync(`${f}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
  return next;
}
