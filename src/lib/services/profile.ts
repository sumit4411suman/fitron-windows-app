import { describeAudit } from "@/lib/domain/audit";
import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { deleteObject, getObject, putObject, sniffType } from "@/lib/integrations/storage";
import type { PasswordChangeInput, ProfileInput } from "@/lib/validation/profile";
import { audit } from "./audit";
import { UserError } from "./errors";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** The signed-in user's own account, for My profile. */
export async function getProfile(u: CurrentUser, sessionId: string | null) {
  const [me, session, activity] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { name: true, email: true, phone: true, photoKey: true, lastLoginAt: true, createdAt: true },
    }),
    sessionId ? db.session.findUnique({ where: { id: sessionId }, select: { createdAt: true } }) : null,
    db.auditLog.findMany({
      where: { orgId: u.orgId, userId: u.id },
      orderBy: { id: "desc" },
      take: 10,
      select: { id: true, action: true, entity: true, entityId: true, before: true, after: true, createdAt: true },
    }),
  ]);
  return { ...me, sessionSince: session?.createdAt ?? null, activity: activity.map((a) => ({ id: a.id, action: a.action, createdAt: a.createdAt, sentence: describeAudit(a) })) };
}

export async function updateProfile(u: CurrentUser, input: ProfileInput) {
  await db.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: u.id }, select: { name: true, phone: true } });
    const after = await tx.user.update({ where: { id: u.id }, data: { name: input.name, phone: input.phone }, select: { name: true, phone: true } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "profile.update", entity: "User", entityId: u.id, before, after });
  });
}

/** Checks the current password, sets the new one and signs out every other device. */
export async function changePassword(u: CurrentUser, sessionId: string | null, input: PasswordChangeInput) {
  const me = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(me.passwordHash, input.current))) throw new UserError("Your current password is wrong.", "current");
  if (input.current === input.password) throw new UserError("Choose a password different from the current one.", "password");
  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: u.id, ...(sessionId ? { id: { not: sessionId } } : {}) } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "profile.password", entity: "User", entityId: u.id });
  });
}

export async function setProfilePhoto(u: CurrentUser, file: File) {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) throw new UserError("Choose a photo.", "photo");
  if (file.size > MAX_PHOTO_BYTES) throw new UserError("That photo is over 5 MB. Pick a smaller one.", "photo");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type || !PHOTO_TYPES.includes(type.mime)) throw new UserError("Use a JPG, PNG or WebP photo.", "photo");
  const key = `${u.orgId}/staff/${u.id}/${randomUUID()}.${type.ext}`;
  await putObject(key, bytes, type.mime);
  let old: string | null;
  try {
    old = await db.$transaction(async (tx) => {
      const { photoKey } = await tx.user.findUniqueOrThrow({ where: { id: u.id }, select: { photoKey: true } });
      await tx.user.update({ where: { id: u.id }, data: { photoKey: key } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "profile.photo", entity: "User", entityId: u.id, before: { photoKey }, after: { photoKey: key } });
      return photoKey;
    });
  } catch (e) {
    await deleteObject(key).catch(() => {});
    throw e;
  }
  // The old file goes once the new one is saved.
  if (old) await deleteObject(old).catch(() => {});
}

export async function removeProfilePhoto(u: CurrentUser) {
  const old = await db.$transaction(async (tx) => {
    const { photoKey } = await tx.user.findUniqueOrThrow({ where: { id: u.id }, select: { photoKey: true } });
    if (!photoKey) return null;
    await tx.user.update({ where: { id: u.id }, data: { photoKey: null } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "profile.photo.remove", entity: "User", entityId: u.id, before: { photoKey }, after: { photoKey: null } });
    return photoKey;
  });
  if (old) await deleteObject(old).catch(() => {});
}

/** A colleague's photo, for anyone signed in to the same gym. */
export async function readProfilePhoto(u: CurrentUser, userId: string) {
  const staff = await db.user.findFirst({ where: { id: userId, orgId: u.orgId }, select: { photoKey: true } });
  if (!staff?.photoKey) return null;
  const ext = staff.photoKey.split(".").pop();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { body: await getObject(staff.photoKey), mime };
}
