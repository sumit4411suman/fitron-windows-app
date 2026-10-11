import "server-only";
import { fileStorage, isFileMissing } from "@/lib/storage";

// The app's file functions, kept here so their callers did not change when storage became an interface
// (src/lib/storage: S3FileStorage for the Cloud Edition's bucket, DiskFileStorage for a server folder and for the Local
// Edition's …\FITRON\documents). Objects are never public: the app reads them back itself after a permission check.

export { signV4 } from "@/lib/storage/s3-storage";
export { FileMissingError, isFileMissing } from "@/lib/storage";

export const storageMode = () => fileStorage().mode;

export const putObject = (key: string, body: Uint8Array, contentType: string) => fileStorage().put(key, body, contentType);

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
