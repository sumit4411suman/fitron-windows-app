import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDirs } from "./paths";

// Settings of this installation, not of a gym: kept in <data>\settings.json, beside the database rather than in it, so
// a restore does not change them (the automatic backup must keep running after restoring an old backup).
// deviceNetwork: door devices on the gym's network may connect to this computer on devicePort
// (src/lib/integrations/door-devices). Off until a Super Admin turns it on.
export type LocalSettings = { autoBackup: boolean; keepAutoBackups: number; keepSafetyBackups: number; deviceNetwork: boolean; devicePort: number };
/** The port FITRON suggests for door devices: the one usually used for ADMS. */
export const DEFAULT_DEVICE_PORT = 8081;
export const DEFAULT_LOCAL_SETTINGS: LocalSettings = { autoBackup: true, keepAutoBackups: 14, keepSafetyBackups: 10, deviceNetwork: false, devicePort: DEFAULT_DEVICE_PORT };

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
  next.deviceNetwork = next.deviceNetwork === true;
  if (!Number.isInteger(next.devicePort) || next.devicePort < 1 || next.devicePort > 65535) next.devicePort = DEFAULT_DEVICE_PORT;
  const f = file(root);
  writeFileSync(`${f}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
  return next;
}
