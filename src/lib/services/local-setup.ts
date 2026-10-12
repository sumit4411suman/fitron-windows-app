import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isLocal } from "@/lib/runtime/edition";
import { clearFailures } from "@/lib/auth/lockout";
import type { LocalRecoverInput, LocalSetupInput } from "@/lib/validation/local-setup";
import { ensureExpenseCategories, ensureRoles } from "../../../prisma/roles";
import { audit } from "./audit";
import { UserError, isUniqueViolation } from "./errors";

// First run of the Local Windows Edition. On a new computer there is no fitron.in sign-up, no email to confirm and maybe
// no internet: the owner creates the gym, its first branch and their own Super Admin login on the computer itself.
// Everything is written in one transaction, so a crash leaves either nothing or a complete gym.
//
// The owner also gets a recovery key, shown once. It is the only way to reset the owner's password without email; only
// its Argon2id hash is kept (Setting "localRecovery"). Staff passwords are reset by a Super Admin from Staff, as in the
// Cloud Edition.

export const RECOVERY_SETTING = "localRecovery";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I to misread

/** A recovery key: 20 characters in five groups, about 100 bits. "K7QF-…". */
export function makeRecoveryKey(): string {
  const b = randomBytes(20);
  const chars = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

/**
 * The recovery key waits here, in this process's memory only, between the setup form and the page that shows it
 * (/setup/key): never in a cookie, a log or the database. It is handed out once, to the owner it belongs to, and
 * forgotten after ten minutes either way.
 */
const pendingKeys = new Map<string, { key: string; until: number }>();
const KEY_SHOWN_FOR_MS = 10 * 60_000;

export function holdRecoveryKey(userId: string, key: string, now = Date.now()) {
  for (const [id, v] of pendingKeys) if (v.until < now) pendingKeys.delete(id);
  pendingKeys.set(userId, { key, until: now + KEY_SHOWN_FOR_MS });
}

export function takeRecoveryKey(userId: string, now = Date.now()): string | null {
  const v = pendingKeys.get(userId);
  pendingKeys.delete(userId);
  return v && v.until >= now ? v.key : null;
}

const normaliseKey = (k: string) => k.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The stored form of a recovery key (Setting "localRecovery"): only its hash. */
export const recoveryValue = async (key: string) => ({ hash: await hashPassword(normaliseKey(key)), createdAt: new Date().toISOString() });

/** True until the first gym exists on this computer. Only ever true in the Local Edition. */
// `client` is the app's database; a test passes a client of its own fresh file.
type Client = typeof db;

export async function localSetupNeeded(client: Client = db): Promise<boolean> {
  if (!isLocal()) return false;
  return (await client.user.count()) === 0;
}

export async function createLocalGym(d: LocalSetupInput, client: Client = db): Promise<{ userId: string; orgId: string; recoveryKey: string }> {
  if (!isLocal()) throw new UserError("First-run setup is only for FITRON on a computer.");
  const roles = await ensureRoles(client);
  await ensureExpenseCategories(client);
  const passwordHash = await hashPassword(d.password);
  const recoveryKey = makeRecoveryKey();
  const recoveryHash = await hashPassword(normaliseKey(recoveryKey));
  try {
    return await client.$transaction(async (tx) => {
      // Checked inside the transaction: two windows pressing Create at once make one gym, not two.
      if ((await tx.user.count()) > 0) throw new UserError("FITRON is already set up on this computer. Sign in instead.");
      // No trialEndsAt: a gym on a computer is not on a FITRON cloud trial. What it may use is decided by its licence.
      const org = await tx.organization.create({ data: { name: d.gymName, plan: "enterprise", planCycle: "YEARLY" } });
      const branch = await tx.branch.create({ data: { orgId: org.id, name: d.branchName, address: d.address ?? "", phone: d.phone } });
      await tx.setting.create({ data: { orgId: org.id, key: "gym", value: { name: d.gymName, phone: d.phone, email: d.email, address: d.address ?? "" } } });
      // The owner then goes through the same first-run steps as a gym that signed up on fitron.in (src/app/onboarding).
      await tx.setting.create({ data: { orgId: org.id, key: "onboarding", value: { status: "PENDING" } } });
      await tx.setting.create({ data: { orgId: org.id, key: RECOVERY_SETTING, value: { hash: recoveryHash, createdAt: new Date().toISOString() } } });
      const owner = await tx.user.create({
        data: {
          orgId: org.id,
          name: d.ownerName,
          email: d.email,
          phone: d.phone,
          roleId: roles.get("Super Admin")!,
          passwordHash,
          emailVerifiedAt: new Date(),
          branches: { create: [{ branchId: branch.id }] },
        },
      });
      await audit(tx, { orgId: org.id, userId: owner.id, action: "account.create", entity: "Organization", entityId: org.id, after: { via: "local-setup", gym: d.gymName, branch: d.branchName } });
      return { userId: owner.id, orgId: org.id, recoveryKey };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("There's already an account with this email on this computer.", "email");
    throw e;
  }
}

/**
 * Sets a new owner password with the recovery key. Only a Super Admin's password can be reset this way. The key is
 * used up: a new one is made and returned, to be shown once like the first. Every session of that person ends.
 * The same answer is given for an unknown email and a wrong key.
 */
export async function recoverOwner(d: LocalRecoverInput, client: Client = db): Promise<{ recoveryKey: string } | null> {
  if (!isLocal()) return null;
  const user = await client.user.findFirst({ where: { email: d.email, active: true, deletedAt: null, role: { name: "Super Admin" } } });
  const setting = user ? await client.setting.findUnique({ where: { orgId_key: { orgId: user.orgId, key: RECOVERY_SETTING } } }) : null;
  const hash = (setting?.value as { hash?: string } | null)?.hash;
  const ok = await verifyPassword(hash ?? (await hashPassword("no-recovery-key-here")), normaliseKey(d.recoveryKey));
  if (!user || !hash || !ok) return null;
  const next = makeRecoveryKey();
  const [passwordHash, nextHash] = await Promise.all([hashPassword(d.password), hashPassword(normaliseKey(next))]);
  await client.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.setting.update({ where: { orgId_key: { orgId: user.orgId, key: RECOVERY_SETTING } }, data: { value: { hash: nextHash, createdAt: new Date().toISOString() } } });
    await audit(tx, { orgId: user.orgId, userId: user.id, action: "auth.recovery-key-reset", entity: "User", entityId: user.id });
  });
  // The owner proved who they are: a lockout from the forgotten password ends too.
  clearFailures(d.email);
  return { recoveryKey: next };
}
