import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { CurrentUser } from "@/lib/auth/current";
import { verifyPassword } from "@/lib/auth/password";
import { generateRecoveryCodes, generateSecret, groupSecret, normalizeRecoveryCode, otpauthUrl, verifyCode } from "@/lib/auth/totp";
import { db } from "@/lib/db";
import { audit } from "./audit";
import { UserError } from "./errors";

// Two-step sign-in for staff: after the password (or Google), a 6-digit code from an authenticator app, or one of ten
// recovery codes. A person turns it on in My profile; a Super Admin can turn it off for someone who lost their phone.
//
// What is kept: the authenticator secret, sealed with AES-256-GCM (a key derived from BIOMETRIC_KEY: keep that safe, and
// do not change it, or every secret becomes unreadable and people must set two-step up again); the step of the last
// code accepted; and the SHA-256 of each recovery code (50 random bits each, so a fast hash is enough). A secret exists
// as soon as setup starts, but nothing is asked for at sign-in until `totpEnabledAt` is set by a confirmed code.

export const ISSUER = "FITRON";

function key() {
  const k = process.env.BIOMETRIC_KEY?.trim();
  if (k) return createHash("sha256").update(`fitron-two-step:${k}`).digest();
  if (process.env.NODE_ENV === "production") throw new Error("BIOMETRIC_KEY is not set; refusing to store two-step secrets.");
  return createHash("sha256").update("fitron-dev-only-two-step-key").digest();
}

/**
 * The keys two-step sign-in needs, when the server is in production: BIOMETRIC_KEY seals the secrets, and AUTH_SECRET (or
 * CRON_SECRET, which it falls back to) signs the cookie that carries a sign-in between the password and the code. The installer
 * sets both. Without either, setup is refused: a person who turned it on could never finish signing in.
 */
export function missingKeys(): string[] {
  if (process.env.NODE_ENV !== "production") return [];
  const out: string[] = [];
  if (!process.env.BIOMETRIC_KEY?.trim()) out.push("BIOMETRIC_KEY");
  if (!process.env.AUTH_SECRET?.trim() && !process.env.CRON_SECRET?.trim()) out.push("AUTH_SECRET");
  return out;
}

export function sealSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function unsealSecret(b: Uint8Array) {
  const buf = Buffer.from(b);
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export const hashRecoveryCode = (normalized: string) => createHash("sha256").update(normalized).digest("hex");

export type TwoStepStatus = { enabled: boolean; enabledAt: Date | null; recoveryLeft: number };

export async function twoStepStatus(userId: string): Promise<TwoStepStatus> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true } });
  const recoveryLeft = u.totpEnabledAt ? await db.recoveryCode.count({ where: { userId, usedAt: null } }) : 0;
  return { enabled: !!u.totpEnabledAt, enabledAt: u.totpEnabledAt, recoveryLeft };
}

export type Setup = { secret: string; grouped: string; otpauth: string };
const setupFor = (secret: string, email: string): Setup => ({ secret, grouped: groupSecret(secret), otpauth: otpauthUrl({ secret, account: email, issuer: ISSUER }) });

/** Starts setup: makes a secret (a new one each time) for the person to add to their authenticator app. Nothing is asked for at sign-in yet. */
export async function beginTwoStep(u: CurrentUser): Promise<Setup> {
  const me = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpEnabledAt: true, email: true } });
  if (me.totpEnabledAt) throw new UserError("Two-step sign-in is already on.");
  const missing = missingKeys();
  if (missing.length) throw new UserError(`Two-step sign-in cannot be turned on yet: this server has no ${missing.join(" or ")} set. Ask whoever runs the server to add it (see deploy/README.md).`);
  const secret = generateSecret();
  await db.user.update({ where: { id: u.id }, data: { totpSecret: sealSecret(secret), totpLastStep: null } });
  return setupFor(secret, me.email);
}

/** The setup in progress, to show its QR code again after a page load; null if none. */
export async function pendingSetup(u: CurrentUser): Promise<Setup | null> {
  const me = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpSecret: true, totpEnabledAt: true, email: true } });
  if (!me.totpSecret || me.totpEnabledAt) return null;
  return setupFor(unsealSecret(me.totpSecret), me.email);
}

export async function cancelTwoStep(u: CurrentUser) {
  await db.user.updateMany({ where: { id: u.id, totpEnabledAt: null }, data: { totpSecret: null, totpLastStep: null } });
}

async function newRecoveryCodes(tx: Pick<typeof db, "recoveryCode">, userId: string) {
  const codes = generateRecoveryCodes();
  await tx.recoveryCode.deleteMany({ where: { userId } });
  await tx.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(normalizeRecoveryCode(c)!) })) });
  return codes;
}

/** Turns two-step on once the person has shown that their app makes the right code. Returns the recovery codes: the only time they are shown. */
export async function confirmTwoStep(u: CurrentUser, code: string): Promise<string[]> {
  const me = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpSecret: true, totpEnabledAt: true } });
  if (me.totpEnabledAt) throw new UserError("Two-step sign-in is already on.");
  if (!me.totpSecret) throw new UserError("Start the setup again: there is no code to check against.");
  const step = verifyCode(unsealSecret(me.totpSecret), code);
  if (step === null) throw new UserError("That code is not right. Check the code in your app (it changes every 30 seconds) and try again.", "code");
  return db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpLastStep: step } });
    const codes = await newRecoveryCodes(tx, u.id);
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "auth.two-step-on", entity: "User", entityId: u.id });
    return codes;
  });
}

/**
 * Checks the second step of a sign-in: an authenticator code (once only: the step it is for is recorded) or a recovery code
 * (used up). Says which one worked, or null. Callers limit how often this is tried (src/app/login/actions.ts).
 */
export async function verifySecondFactor(userId: string, input: string, now = Date.now()): Promise<"code" | "recovery" | null> {
  const me = await db.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true } });
  if (!me?.totpSecret || !me.totpEnabledAt) return null;
  const recovery = normalizeRecoveryCode(input);
  if (recovery) {
    const used = await db.recoveryCode.updateMany({ where: { userId, codeHash: hashRecoveryCode(recovery), usedAt: null }, data: { usedAt: new Date(now) } });
    return used.count === 1 ? "recovery" : null;
  }
  const step = verifyCode(unsealSecret(me.totpSecret), input, now, me.totpLastStep);
  if (step === null) return null;
  // Claim the step in one statement, so two sign-ins using the same code at the same moment cannot both succeed.
  const claimed = await db.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
  return claimed.count === 1 ? "code" : null;
}

async function checkIdentity(u: CurrentUser, password: string) {
  const me = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { passwordHash: true, totpEnabledAt: true } });
  if (!me.totpEnabledAt) throw new UserError("Two-step sign-in is not on.");
  if (!(await verifyPassword(me.passwordHash, password))) throw new UserError("Your password is wrong.", "password");
}

/** Turns two-step off: needs the password and a current code (or a recovery code), so a borrowed session cannot do it. */
export async function disableTwoStep(u: CurrentUser, input: { password: string; code: string }) {
  await checkIdentity(u, input.password);
  if (!(await verifySecondFactor(u.id, input.code))) throw new UserError("That code is not right.", "code");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null } });
    await tx.recoveryCode.deleteMany({ where: { userId: u.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "auth.two-step-off", entity: "User", entityId: u.id });
  });
}

/** Replaces the recovery codes with ten new ones (the old ones stop working). Needs the password. Returns the new codes. */
export async function regenerateRecoveryCodes(u: CurrentUser, input: { password: string }): Promise<string[]> {
  await checkIdentity(u, input.password);
  return db.$transaction(async (tx) => {
    const codes = await newRecoveryCodes(tx, u.id);
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "auth.recovery-codes-new", entity: "User", entityId: u.id });
    return codes;
  });
}

/** A Super Admin or Admin turns two-step off for someone who lost their phone and their recovery codes. They are signed out everywhere. */
export async function adminResetTwoStep(actor: CurrentUser, targetId: string) {
  const target = await db.user.findFirst({ where: { id: targetId, orgId: actor.orgId, deletedAt: null }, select: { id: true, name: true, totpEnabledAt: true, role: { select: { name: true } } } });
  if (!target) throw new UserError("That person is not on your team.");
  if (target.id === actor.id) throw new UserError("Turn off your own two-step sign-in in My profile.");
  if (target.role.name === "Super Admin" && actor.role !== "Super Admin") throw new UserError("Only a Super Admin can change the Super Admin account.");
  if (!target.totpEnabledAt) throw new UserError(`${target.name} does not use two-step sign-in.`);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null } });
    await tx.recoveryCode.deleteMany({ where: { userId: target.id } });
    await tx.session.deleteMany({ where: { userId: target.id } });
    await audit(tx, { orgId: actor.orgId, userId: actor.id, action: "auth.two-step-reset", entity: "User", entityId: target.id });
  });
}
