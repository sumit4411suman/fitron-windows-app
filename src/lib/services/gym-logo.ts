import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { deleteObject, getObject, putObject, sniffType } from "@/lib/integrations/storage";
import { audit } from "./audit";
import { UserError } from "./errors";
import { putSettingIn, type GymProfile } from "./settings";

export const MAX_LOGO_BYTES = 1 * 1024 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Stores the gym's logo privately and points Setting.gym.logoKey at it; the old file goes after the commit. */
export async function setGymLogo(u: CurrentUser, file: File) {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) throw new UserError("Choose a logo.", "logo");
  if (file.size > MAX_LOGO_BYTES) throw new UserError("Logo must be under 1 MB.", "logo");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type || !LOGO_TYPES.includes(type.mime)) throw new UserError("Use a PNG or JPG logo.", "logo");
  const key = `${u.orgId}/gym/logo-${randomUUID()}.${type.ext}`;
  await putObject(key, bytes, type.mime);
  let old: string | null;
  try {
    old = await db.$transaction(async (tx) => {
      const gym = ((await tx.setting.findUnique({ where: { orgId_key: { orgId: u.orgId, key: "gym" } } }))?.value as Partial<GymProfile> | null) ?? {};
      const was = gym.logoKey ?? null;
      await putSettingIn(tx, u, "gym", { logoKey: key });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "gym.logo", entity: "Setting", entityId: "gym", before: { logoKey: was }, after: { logoKey: key } });
      return was;
    });
  } catch (e) {
    await deleteObject(key).catch(() => {});
    throw e;
  }
  if (old) await deleteObject(old).catch(() => {});
}

/** Back to the default FITRON logo. A no-op when none is set. */
export async function removeGymLogo(u: CurrentUser) {
  const old = await db.$transaction(async (tx) => {
    const gym = ((await tx.setting.findUnique({ where: { orgId_key: { orgId: u.orgId, key: "gym" } } }))?.value as Partial<GymProfile> | null) ?? {};
    if (!gym.logoKey) return null;
    await putSettingIn(tx, u, "gym", { logoKey: null });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "gym.logo.remove", entity: "Setting", entityId: "gym", before: { logoKey: gym.logoKey }, after: { logoKey: null } });
    return gym.logoKey;
  });
  if (old) await deleteObject(old).catch(() => {});
}

export const logoMime = (key: string) => {
  const ext = key.split(".").pop();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
};

/** The gym's logo bytes for anyone signed in to it (it is on every page), or null for the default. */
export async function readGymLogo(orgId: string) {
  const gym = (await db.setting.findUnique({ where: { orgId_key: { orgId, key: "gym" } } }))?.value as Partial<GymProfile> | null;
  if (!gym?.logoKey) return null;
  return { body: await getObject(gym.logoKey), mime: logoMime(gym.logoKey) };
}
