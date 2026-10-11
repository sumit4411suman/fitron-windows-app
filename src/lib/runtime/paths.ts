import os from "node:os";
import path from "node:path";
import { isLocal } from "./edition";

// Where the Local Edition keeps the customer's data. The desktop shell passes the folder it resolved
// (FITRON_DATA_DIR); without it, the platform's per-user application-data folder is used, never the program folder:
//   Windows  %LOCALAPPDATA%\FITRON            (C:\Users\<name>\AppData\Local\FITRON)
//   macOS    ~/Library/Application Support/FITRON
//   Linux    $XDG_DATA_HOME/FITRON or ~/.local/share/FITRON
// Nothing here is a fixed Windows path: every piece comes from the environment of the signed-in Windows user.
export type DataDirs = {
  root: string;
  data: string;
  backups: string;
  documents: string;
  logs: string;
  /** The SQLite database file. */
  database: string;
};

export function defaultDataRoot(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
  const given = env.FITRON_DATA_DIR?.trim();
  if (given) return path.resolve(given);
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "FITRON");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "FITRON");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "FITRON");
}

export function dataDirs(root = defaultDataRoot()): DataDirs {
  return {
    root,
    data: path.join(root, "data"),
    backups: path.join(root, "backups"),
    documents: path.join(root, "documents"),
    logs: path.join(root, "logs"),
    database: path.join(root, "data", "fitron.db"),
  };
}

/** The SQLite connection string of the Local Edition: DATABASE_URL when the shell set one, else the default file. */
export function localDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL?.trim();
  if (url && url.startsWith("file:")) return url;
  return `file:${dataDirs(defaultDataRoot(env)).database}`;
}

/** Where member documents, photos, logos and attachments go in the Local Edition (src/lib/integrations/storage.ts). */
export function localStorageDir(env: Record<string, string | undefined> = process.env): string {
  return env.STORAGE_DIR?.trim() || dataDirs(defaultDataRoot(env)).documents;
}

export const localEditionActive = () => isLocal();
