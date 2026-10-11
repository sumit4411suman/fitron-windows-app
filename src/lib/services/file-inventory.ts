import "server-only";
import { db } from "@/lib/db";
import { fileStorage, type FileStorage } from "@/lib/storage";

// Every file a gym's records point to, and whether storage still has it. The metadata (what the file is, whose it is,
// its name and size) is in the database; storage holds only the bytes, under "<orgId>/…". This is the list a backup
// copies (Phase 10) and the check Settings › Backup runs:
//   missing  the database points to a file that is not in storage (the documents folder was not restored, or a file
//            was deleted outside FITRON). The record stays; the file shows as "not found".
//   orphans  files under the gym's folder that no record points to (an upload whose record failed to save). Harmless;
//            reported, never deleted automatically.

export type FileKind = "member-document" | "member-photo" | "staff-photo" | "gym-logo" | "backup";
export type ReferencedFile = { key: string; kind: FileKind; size?: number };
export type Inventory = { referenced: ReferencedFile[]; present: number; missing: ReferencedFile[]; orphans: string[]; bytes: number };

/** The files the gym's records point to, each once (a document that is also the member's photo counts as a document). */
export async function referencedFiles(orgId: string): Promise<ReferencedFile[]> {
  const [docs, members, staff, gym, backups] = await Promise.all([
    db.memberDocument.findMany({ where: { orgId }, select: { storageKey: true, size: true } }),
    db.member.findMany({ where: { orgId, photoKey: { not: null } }, select: { photoKey: true } }),
    db.user.findMany({ where: { orgId, photoKey: { not: null } }, select: { photoKey: true } }),
    db.setting.findUnique({ where: { orgId_key: { orgId, key: "gym" } } }),
    db.backup.findMany({ where: { orgId }, select: { storageKey: true, size: true } }),
  ]);
  const out = new Map<string, ReferencedFile>();
  const add = (f: ReferencedFile) => void (out.has(f.key) || out.set(f.key, f));
  for (const d of docs) add({ key: d.storageKey, kind: "member-document", size: d.size });
  for (const m of members) add({ key: m.photoKey!, kind: "member-photo" });
  for (const u of staff) add({ key: u.photoKey!, kind: "staff-photo" });
  const logo = (gym?.value as { logoKey?: string } | null)?.logoKey;
  if (logo) add({ key: logo, kind: "gym-logo" });
  for (const b of backups) add({ key: b.storageKey, kind: "backup", size: b.size });
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function fileInventory(orgId: string, storage: FileStorage = fileStorage()): Promise<Inventory> {
  const [referenced, stored] = await Promise.all([referencedFiles(orgId), storage.list(`${orgId}/`)]);
  const have = new Map(stored.map((f) => [f.key, f]));
  const wanted = new Set(referenced.map((f) => f.key));
  const missing = referenced.filter((f) => !have.has(f.key));
  const orphans = stored.filter((f) => !wanted.has(f.key)).map((f) => f.key);
  const bytes = referenced.reduce((n, f) => n + (have.get(f.key)?.size ?? 0), 0);
  return { referenced, present: referenced.length - missing.length, missing, orphans, bytes };
}
