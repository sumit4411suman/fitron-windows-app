// Where FITRON keeps files (member documents and photos, staff photos, the gym logo, backups): an interface with two
// implementations, picked once per process (src/lib/storage/index.ts).
//
//   FileStorage
//   ├── S3FileStorage     Cloud Edition with S3_* set: a private S3-compatible bucket (AWS, R2, Supabase Storage)
//   └── DiskFileStorage   Cloud Edition without S3 (STORAGE_DIR), and the Local Edition (…\FITRON\documents)
//
// Files are addressed by a key the app makes ("<orgId>/members/<memberId>/<uuid>.pdf"). What a file is, who it belongs
// to, its name and size live in the database (MemberDocument, Member.photoKey, User.photoKey, the gym setting's logoKey,
// Backup); storage only holds the bytes. Large files never go into the database.

export type StoredFileInfo = { key: string; size: number; modifiedAt: Date };

export interface FileStorage {
  /** "S3" or "DISK", shown in Settings › Help › System details. */
  readonly mode: "S3" | "DISK";
  /** Writes the whole file, or nothing: a crash mid-write never leaves half a file under the key. */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** The bytes, or FileMissingError when there is no such file. */
  get(key: string): Promise<Uint8Array>;
  /** Removes the file; removing a missing file is not an error. */
  delete(key: string): Promise<void>;
  /** Size and time of a file, or null when there is none. */
  stat(key: string): Promise<StoredFileInfo | null>;
  /** Every file whose key starts with `prefix` (for backups and the file check). */
  list(prefix: string): Promise<StoredFileInfo[]>;
}

/** Asked for a file that is not there (deleted outside FITRON, a disk restored without its documents folder…). */
export class FileMissingError extends Error {
  constructor(readonly key: string) {
    super(`File not found in storage: ${key}`);
    this.name = "FileMissingError";
  }
}

export const isFileMissing = (e: unknown): e is FileMissingError => e instanceof FileMissingError;

// Windows refuses these as file names, with or without an extension ("CON.pdf", "nul").
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * A key the app may store under: segments of letters, digits, dot, dash and underscore joined by "/", nothing that
 * climbs out of the storage folder, nothing Windows cannot name. Keys are always made by the app; this is the guard in
 * case a bug or a hand-edited row ever passes something else.
 */
export function assertValidKey(key: string): void {
  const segs = key.split("/");
  const ok =
    key.length > 0 &&
    key.length <= 200 &&
    segs.every((s) => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(s) && !s.endsWith(".") && !RESERVED.test(s) && s !== "..");
  if (!ok) throw new Error(`Bad storage key: ${JSON.stringify(key)}`);
}
