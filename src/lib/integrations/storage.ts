import "server-only";
import { fileStorage, isFileMissing, s3Config } from "@/lib/storage";
import { UserError } from "@/lib/services/errors";
import { log } from "@/lib/log";
import { isLocal } from "@/lib/runtime/edition";

// The app's file functions, kept here so their callers did not change when storage became an interface
// (src/lib/storage: S3FileStorage for the Cloud Edition's bucket, DiskFileStorage for a server folder and for the Local
// Edition's …\FITRON\documents, DatabaseFileStorage for a host with no disk and no bucket). Objects are never public: the
// app reads them back itself after a permission check.

export { signV4 } from "@/lib/storage/s3-storage";
export { FileMissingError, isFileMissing } from "@/lib/storage";

/** Where files go: the bucket, a folder (the server's, or the Local Edition's data folder), or the database. */
export const storageMode = () => fileStorage().mode;

const env = (k: string) => process.env[k]?.trim() || "";
const S3_KEYS = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;

/**
 * What is wrong with the storage set-up, in the host's terms (setting names, deploy notes), or null. For the server
 * log and whoever runs the server; never shown to a gym, whose staff can't change server settings. The Local Edition
 * has no such settings: its files always go to the data folder.
 */
export function storageDetail(): string | null {
  if (isLocal() || s3Config()) return null;
  const set = S3_KEYS.filter((k) => env(k));
  const missing = S3_KEYS.filter((k) => !env(k));
  if (set.length) return `S3 storage is half set up: ${set.join(", ")} set but ${missing.join(", ")} missing.`;
  if (env("VERCEL")) return "No S3_* bucket settings on a host without a disk; files are kept in the database (deploy/VERCEL.md step 1.5).";
  return null;
}

let told = false;

/**
 * Why files cannot be saved right now, in words a gym owner understands, or null when storage is usable. Exported for
 * the Backup tab, so the problem shows before anyone tries an upload. The technical reason goes to the server log.
 */
export function storageProblem(): string | null {
  const detail = storageDetail();
  if (detail && !told) {
    told = true;
    log.warn("storage.config", undefined, { detail });
  }
  // Without a disk, files go to the database instead, so nothing is blocked.
  if (!detail || storageMode() === "DATABASE") return null;
  return "File storage on this server is not fully connected, so backups, photos and documents can't be saved yet. Fitron support has the details; write to support@fitron.in if this stays.";
}

/** The largest file kept in the database when there is no bucket; bigger ones need a bucket. */
const DB_FILE_MAX = 50 * 1024 * 1024;

/** The message shown when a write to the folder fails: the disk is full, read-only, or (hosted) this host has none. */
const diskWriteFailed = () =>
  isLocal()
    ? "Could not save the file: the disk is full, or the FITRON data folder is not writable. Free some space or check the folder's permissions, then try again."
    : "Could not save the file: the server's file storage is full or not writable. Ask whoever hosts Fitron (or support) to check the storage folder or connect a bucket.";

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  const s = fileStorage();
  if (s.mode === "DATABASE" && body.byteLength > DB_FILE_MAX) throw new UserError("That file is too large to save on this server. Write to support@fitron.in to connect larger file storage.");
  if (s.mode === "DISK") {
    const problem = storageProblem();
    if (problem) throw new UserError(problem);
  }
  try {
    await s.put(key, body, contentType);
  } catch (e) {
    if (s.mode !== "DISK") throw e;
    log.error("storage.write_failed", e, { key });
    throw new UserError(diskWriteFailed());
  }
}

export const getObject = (key: string): Promise<Uint8Array> => fileStorage().get(key);

/** The bytes, or null when the file is gone (deleted outside FITRON, or a folder restored without it). */
export async function getObjectOrNull(key: string): Promise<Uint8Array | null> {
  try {
    return await fileStorage().get(key);
  } catch (e) {
    if (isFileMissing(e)) return null;
    throw e;
  }
}

export const deleteObject = (key: string) => fileStorage().delete(key);

/** What the bytes actually are, whatever the file name says. Only these types are accepted. */
export function sniffType(b: Uint8Array): { mime: string; ext: string } | null {
  const hex = Buffer.from(b.subarray(0, 12)).toString("hex");
  if (hex.startsWith("25504446")) return { mime: "application/pdf", ext: "pdf" };
  if (hex.startsWith("ffd8ff")) return { mime: "image/jpeg", ext: "jpg" };
  if (hex.startsWith("89504e470d0a1a0a")) return { mime: "image/png", ext: "png" };
  if (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") return { mime: "image/webp", ext: "webp" };
  if (hex.slice(8, 16) === "66747970" && /^(68656963|68656978|6d696631|6d736631)/.test(hex.slice(16, 24))) return { mime: "image/heic", ext: "heic" };
  return null;
}
