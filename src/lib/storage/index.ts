import { isLocal } from "@/lib/runtime/edition";
import { localStorageDir } from "@/lib/runtime/paths";
import { DatabaseFileStorage } from "./database-storage";
import { DiskFileStorage } from "./disk-storage";
import type { FileStorage } from "./file-storage";
import { S3FileStorage, type S3Config } from "./s3-storage";

export { FileMissingError, isFileMissing, assertValidKey, type FileStorage, type StoredFileInfo } from "./file-storage";
export { DatabaseFileStorage } from "./database-storage";
export { DiskFileStorage } from "./disk-storage";
export { S3FileStorage } from "./s3-storage";

const env = (k: string) => process.env[k]?.trim() || "";

export function s3Config(): S3Config | null {
  const c = { endpoint: env("S3_ENDPOINT"), bucket: env("S3_BUCKET"), region: env("S3_REGION") || "auto", accessKeyId: env("S3_ACCESS_KEY_ID"), secretAccessKey: env("S3_SECRET_ACCESS_KEY") };
  return c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey ? c : null;
}

/**
 * The storage this process uses. Local Edition: always the customer's data folder (…\FITRON\documents), whatever the
 * environment says, so a gym's files never go to a bucket or the database. Cloud Edition: the S3 bucket when S3_* is
 * set; else, on a host with no disk (Vercel), the database until a bucket is connected; else STORAGE_DIR (default
 * ./storage). Read on each call so a test can change the environment.
 */
export function fileStorage(): FileStorage {
  if (isLocal()) return new DiskFileStorage(localStorageDir());
  const c = s3Config();
  if (c) return new S3FileStorage(c);
  if (env("VERCEL")) return new DatabaseFileStorage();
  return new DiskFileStorage(env("STORAGE_DIR") || "storage");
}
