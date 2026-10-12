import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDirs, type DataDirs } from "./paths";

// The mark a damaged database leaves in the data folder (src/lib/runtime/local-damage.ts). Kept apart from the checks
// themselves so the proxy, which reads it on every request, loads nothing but the file system.

export const DAMAGED_FILE = "DAMAGED.json";
export type Damage = { at: string; problems: string[] };

const marker = (dirs: DataDirs) => path.join(dirs.data, DAMAGED_FILE);

export function markDamaged(problems: string[], dirs: DataDirs = dataDirs()): Damage {
  const d: Damage = { at: new Date().toISOString(), problems: problems.slice(0, 20) };
  mkdirSync(dirs.data, { recursive: true });
  writeFileSync(marker(dirs), JSON.stringify(d, null, 2));
  return d;
}

/** The damage found at start-up, while it stands. */
export function readDamage(dirs: DataDirs = dataDirs()): Damage | null {
  const f = marker(dirs);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Damage;
  } catch {
    return { at: "", problems: [] };
  }
}

export const clearDamage = (dirs: DataDirs = dataDirs()) => rmSync(marker(dirs), { force: true });
