import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { assertValidKey, fileStorage } from "@/lib/storage";
import { deleteObject, getObjectOrNull, putObject, sniffType } from "@/lib/integrations/storage";
import { fileInventory } from "@/lib/services/file-inventory";
import { UserError } from "@/lib/services/errors";

// Cloud sync of files (member documents and photos, staff photos, the gym's logo). Records sync as rows; the bytes they
// point to follow here, by storage key, which is the same on both sides ("<orgId>/members/<memberId>/<uuid>.pdf"):
//   - a side whose records point to a file it does not have gets it from the other side;
//   - a file whose last record went away through sync (a member erased, a photo replaced) goes on this side too, so an
//     erasure on fitron.in also erases the computer's copy, and the other way round.
// Only files a record of the same gym points to move, never backups, and only the types an upload accepts (sniffed).
// Bodies travel in pieces of FILE_PART bytes: the host fitron.in runs on takes requests and answers up to about 4.5 MB.

export const SYNC_FILE_MAX = 10 * 1024 * 1024;
export const FILE_PART = 3 * 1024 * 1024;

type Row = Record<string, unknown> | null | undefined;

/** The records that point to files. */
export const FILE_ENTITIES = new Set(["MemberDocument", "Member", "User", "Setting"]);

/** The storage keys a synced record points to. */
export function fileKeysOf(entity: string, row: Row): string[] {
  if (!row) return [];
  const str = (v: unknown) => (typeof v === "string" && v ? [v] : []);
  switch (entity) {
    case "MemberDocument":
      return str(row.storageKey);
    case "Member":
    case "User":
      return str(row.photoKey);
    case "Setting": {
      if (row.key !== "gym") return [];
      const v = row.value;
      return v && typeof v === "object" ? str((v as { logoKey?: unknown }).logoKey) : [];
    }
    default:
      return [];
  }
}

/** Keys `before` pointed to that `after` no longer does. */
export function droppedFileKeys(entity: string, before: Row, after: Row): string[] {
  if (!FILE_ENTITIES.has(entity)) return [];
  const keep = new Set(fileKeysOf(entity, after));
  return fileKeysOf(entity, before).filter((k) => !keep.has(k));
}

function validKey(orgId: string, key: string): boolean {
  if (!key.startsWith(`${orgId}/`) || key.startsWith(`${orgId}/backups/`) || key.startsWith(`${orgId}/sync-parts/`)) return false;
  try {
    assertValidKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Whether a record of the gym points to this file here (backups never count). */
export async function fileInUse(orgId: string, key: string): Promise<boolean> {
  if (!validKey(orgId, key)) return false;
  const [doc, member, user, gym] = await Promise.all([
    db.memberDocument.findFirst({ where: { orgId, storageKey: key }, select: { id: true } }),
    db.member.findFirst({ where: { orgId, photoKey: key }, select: { id: true } }),
    db.user.findFirst({ where: { orgId, photoKey: key }, select: { id: true } }),
    db.setting.findUnique({ where: { orgId_key: { orgId, key: "gym" } }, select: { value: true } }),
  ]);
  return !!(doc || member || user || fileKeysOf("Setting", gym ? { key: "gym", value: gym.value } : null).includes(key));
}

/**
 * After records changed through sync: removes the files among `keys` that no record here points to any more. Each key
 * is checked again, so a key collected from a change that was rolled back, or still used by another record, stays.
 */
export async function removeUnusedFiles(orgId: string, keys: Iterable<string>): Promise<number> {
  let removed = 0;
  for (const key of new Set(keys)) {
    if (!validKey(orgId, key) || (await fileInUse(orgId, key))) continue;
    try {
      await deleteObject(key);
      removed++;
    } catch (e) {
      log.error("sync.file_remove_failed", e, { key });
    }
  }
  return removed;
}

/** Files the gym's records point to that this side does not have (backups aside). */
export async function missingFiles(orgId: string): Promise<string[]> {
  return (await fileInventory(orgId)).missing.filter((f) => f.kind !== "backup" && validKey(orgId, f.key)).map((f) => f.key);
}

// ── fitron.in's end ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A piece of a file a record of the gym points to, with the file's whole size; null when there is no such file here. */
export async function readFilePart(orgId: string, key: string, part: number): Promise<{ body: Uint8Array; size: number; parts: number } | null> {
  if (!(await fileInUse(orgId, key))) return null;
  const all = await getObjectOrNull(key);
  if (!all) return null;
  const parts = Math.max(1, Math.ceil(all.length / FILE_PART));
  if (!Number.isInteger(part) || part < 0 || part >= parts) throw new UserError("No such part of the file.");
  return { body: all.subarray(part * FILE_PART, (part + 1) * FILE_PART), size: all.length, parts };
}

const partKey = (orgId: string, key: string, size: number, i: number) => `${orgId}/sync-parts/${createHash("sha256").update(`${key}\u0000${size}`).digest("hex").slice(0, 40)}/${i}`;

/**
 * Stores one piece of a file a record of the gym points to (records go up before their files). The last piece puts
 * the whole file together, checks its size and type, and stores it under its key. "stored" once the file is complete
 * here, "part" while pieces are missing, "had" when it was already here.
 */
export async function storeFilePart(orgId: string, key: string, o: { part: number; parts: number; size: number }, body: Uint8Array): Promise<"stored" | "part" | "had"> {
  if (!(await fileInUse(orgId, key))) throw new UserError("No record of this gym points to that file here.");
  if (!Number.isInteger(o.size) || o.size <= 0 || o.size > SYNC_FILE_MAX) throw new UserError("That file is too large to sync.");
  const parts = Math.ceil(o.size / FILE_PART);
  if (o.parts !== parts || !Number.isInteger(o.part) || o.part < 0 || o.part >= parts) throw new UserError("No such part of the file.");
  const expected = o.part === parts - 1 ? o.size - o.part * FILE_PART : FILE_PART;
  if (body.length !== expected) throw new UserError("That part of the file is not the size it should be.");
  const store = fileStorage();
  if (await store.stat(key)) return "had";
  if (parts === 1) return save(key, body);
  await store.put(partKey(orgId, key, o.size, o.part), body, "application/octet-stream");
  const pieces: Uint8Array[] = [];
  for (let i = 0; i < parts; i++) {
    const p = await getObjectOrNull(partKey(orgId, key, o.size, i));
    if (!p) return "part";
    pieces.push(p);
  }
  const whole = Buffer.concat(pieces);
  for (let i = 0; i < parts; i++) await store.delete(partKey(orgId, key, o.size, i)).catch(() => {});
  if (whole.length !== o.size) throw new UserError("The file did not arrive whole. FITRON sends it again.");
  return save(key, whole);
}

async function save(key: string, body: Uint8Array): Promise<"stored"> {
  const type = sniffType(body);
  if (!type) throw new UserError("Only PDF, JPG, PNG, WebP and HEIC files sync.");
  await putObject(key, body, type.mime);
  return "stored";
}
