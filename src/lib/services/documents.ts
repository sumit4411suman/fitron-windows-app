import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { deleteObject, getObject, putObject, sniffType } from "@/lib/integrations/storage";
import { audit } from "./audit";
import { UserError } from "./errors";
import { memberScope } from "./members";

export const DOC_KINDS = ["ID proof", "Address proof", "Medical", "Waiver", "Photo", "Other"] as const;
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

async function member(u: CurrentUser, memberId: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId, walkIn: false }, select: { id: true, photoKey: true } });
  if (!m) throw new UserError("Member not found.");
  return m;
}

/** Checks the file and stores it privately. Returns what the database row needs. */
async function store(orgId: string, memberId: string, file: File, forPhoto = false) {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) throw new UserError("Choose a file.", "file");
  if (file.size > MAX_DOC_BYTES) throw new UserError("That file is over 10 MB. Scan at a lower resolution or save as PDF.", "file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type) throw new UserError("Upload a PDF, JPG, PNG, WebP or HEIC file.", "file");
  if (forPhoto && !["image/jpeg", "image/png", "image/webp"].includes(type.mime)) throw new UserError("For the member photo upload a JPG, PNG or WebP.", "file");
  const storageKey = `${orgId}/members/${memberId}/${randomUUID()}.${type.ext}`;
  await putObject(storageKey, bytes, type.mime);
  const fileName = (file.name || `document.${type.ext}`).replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  return { storageKey, mime: type.mime, size: bytes.length, fileName };
}

export async function listDocuments(u: CurrentUser, memberId: string) {
  await member(u, memberId);
  const docs = await db.memberDocument.findMany({ where: { memberId, orgId: u.orgId }, orderBy: { createdAt: "desc" } });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(docs.flatMap((d) => [d.uploadedById, d.deletedById]).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const name = (id: string | null) => users.find((x) => x.id === id)?.name ?? "";
  return docs.map((d) => ({ ...d, uploadedBy: name(d.uploadedById), deletedBy: name(d.deletedById) }));
}

export async function uploadDocument(u: CurrentUser, memberId: string, v: { kind: string; title: string }, file: File) {
  const mem = await member(u, memberId);
  const f = await store(u.orgId, memberId, file, v.kind === "Photo");
  try {
    return await db.$transaction(async (tx) => {
      const d = await tx.memberDocument.create({ data: { orgId: u.orgId, memberId, kind: v.kind, title: v.title, ...f, uploadedById: u.id } });
      if (v.kind === "Photo") {
        await tx.member.update({ where: { id: memberId }, data: { photoKey: d.storageKey } });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.photo", entity: "Member", entityId: memberId, before: { photoKey: mem.photoKey }, after: { photoKey: d.storageKey, documentId: d.id } });
      }
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "document.upload", entity: "MemberDocument", entityId: d.id, after: { memberId, kind: d.kind, title: d.title, fileName: d.fileName, size: d.size } });
      return d;
    });
  } catch (e) {
    await deleteObject(f.storageKey).catch(() => {});
    throw e;
  }
}

/** A new file takes the old one's place; the old one stays in the history. */
export async function replaceDocument(u: CurrentUser, id: string, file: File) {
  const old = await db.memberDocument.findFirst({ where: { id, orgId: u.orgId, status: "ACTIVE" } });
  if (!old) throw new UserError("Document not found.");
  const mem = await member(u, old.memberId);
  const isPhoto = !!mem.photoKey && mem.photoKey === old.storageKey;
  const f = await store(u.orgId, old.memberId, file, isPhoto);
  try {
    return await db.$transaction(async (tx) => {
      const claimed = await tx.memberDocument.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "REPLACED" } });
      if (!claimed.count) throw new UserError("Someone else just changed this document. Reload and try again.");
      const d = await tx.memberDocument.create({ data: { orgId: u.orgId, memberId: old.memberId, kind: old.kind, title: old.title, ...f, uploadedById: u.id } });
      await tx.memberDocument.update({ where: { id }, data: { replacedById: d.id } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "document.replace", entity: "MemberDocument", entityId: d.id, before: { id: old.id, fileName: old.fileName }, after: { fileName: d.fileName, size: d.size } });
      if (isPhoto) {
        await tx.member.update({ where: { id: old.memberId }, data: { photoKey: d.storageKey } });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.photo", entity: "Member", entityId: old.memberId, before: { photoKey: old.storageKey }, after: { photoKey: d.storageKey, documentId: d.id } });
      }
      return d;
    });
  } catch (e) {
    await deleteObject(f.storageKey).catch(() => {});
    throw e;
  }
}

/** Hidden from the member's documents with a reason; the record and file stay for the history. */
export async function deleteDocument(u: CurrentUser, id: string, reason: string) {
  const d = await db.memberDocument.findFirst({ where: { id, orgId: u.orgId, status: "ACTIVE" } });
  if (!d) throw new UserError("Document not found.");
  const mem = await member(u, d.memberId);
  if (!reason.trim()) throw new UserError("Give a reason.", "reason");
  await db.$transaction(async (tx) => {
    await tx.memberDocument.update({ where: { id }, data: { status: "DELETED", deletedAt: new Date(), deletedById: u.id, deleteReason: reason.trim() } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "document.delete", entity: "MemberDocument", entityId: id, before: { fileName: d.fileName, kind: d.kind }, after: { reason: reason.trim() } });
    if (mem.photoKey && mem.photoKey === d.storageKey) {
      await tx.member.update({ where: { id: d.memberId }, data: { photoKey: null } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.photo.remove", entity: "Member", entityId: d.memberId, before: { photoKey: d.storageKey }, after: { photoKey: null, documentId: d.id } });
    }
  });
}

/** The file itself, after a permission check. Every view is audited. */
export async function readDocument(u: CurrentUser, id: string) {
  const d = await db.memberDocument.findFirst({ where: { id, orgId: u.orgId } });
  if (!d) return null;
  if (!(await db.member.findFirst({ where: { ...memberScope(u), id: d.memberId }, select: { id: true } }))) return null;
  const body = await getObject(d.storageKey);
  await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "document.view", entity: "MemberDocument", entityId: id }));
  return { doc: d, body };
}

/** Erase a member's files for good (member deleted, or a DPDP erasure request). */
export async function purgeDocuments(orgId: string, memberId: string) {
  const docs = await db.memberDocument.findMany({ where: { orgId, memberId } });
  for (const d of docs) await deleteObject(d.storageKey);
  await db.memberDocument.deleteMany({ where: { orgId, memberId } });
  return docs.length;
}

/** DPDP erasure: removes a member's profile photo object and clears the column. */
export async function purgeMemberPhoto(orgId: string, memberId: string) {
  const m = await db.member.findFirst({ where: { id: memberId, orgId }, select: { photoKey: true } });
  if (m?.photoKey) await deleteObject(m.photoKey).catch(() => {});
  await db.member.updateMany({ where: { id: memberId, orgId }, data: { photoKey: null } });
}
