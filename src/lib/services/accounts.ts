import "server-only";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { findPlan, TRIAL_DAYS, type Cycle } from "@/lib/domain/pricing";
import { emailReady, sendEmail } from "@/lib/integrations/email";
import { putObject, sniffType } from "@/lib/integrations/storage";
import { audit } from "./audit";
import { MAX_LOGO_BYTES } from "./gym-logo";
import { ensureExpenseCategories, ensureRoles } from "../../../prisma/roles";
import { isUniqueViolation, UserError } from "./errors";
import { log } from "@/lib/log";

// Self sign-up for gyms, email verification, password reset and passwordless sign-in (emailed link or six-digit code).

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const HOUR = 3_600_000;
const LIFETIME = { VERIFY_EMAIL: 48 * HOUR, RESET_PASSWORD: 1 * HOUR, LOGIN: 15 * 60_000 } as const;
type Purpose = keyof typeof LIFETIME;
/** The emailed six-digit codes (the typed-in twin of a link) last this long and allow this many tries, as 10^6 guesses is few. */
const CODE_LIFETIME = 10 * 60_000;
const CODE_TRIES = 5;
type CodePurpose = "VERIFY_EMAIL" | "RESET_PASSWORD" | "LOGIN";

export const appUrl = () => (process.env.APP_URL?.trim() || (process.env.NODE_ENV === "production" ? "https://fitron.in" : "http://localhost:3000")).replace(/\/$/, "");

/** Makes a one-time link token; only its hash is stored. Older unused tokens of the same kind stop working. */
async function issueToken(userId: string, purpose: Purpose) {
  const token = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    db.authToken.create({ data: { id: sha256(token), userId, purpose, expiresAt: new Date(Date.now() + LIFETIME[purpose]) } }),
  ]);
  return token;
}

/** Marks the token used and returns its user id, or null if it is unknown, used or expired. */
async function redeemToken(token: string, purpose: Purpose) {
  const row = await db.authToken.findUnique({ where: { id: sha256(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  const { count } = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count !== 1) return null;
  await retireCodes(row.userId, purpose);
  return row.userId;
}

const codeHash = (userId: string, purpose: CodePurpose, code: string) => sha256(`${userId}:${purpose}:${code}`);

/** Makes a six-digit code for the same email as a link; only its hash is stored. Older unused codes of the same kind stop working. */
async function issueCode(userId: string, purpose: CodePurpose) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.$transaction([
    db.authCode.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    db.authCode.create({ data: { userId, purpose, codeHash: codeHash(userId, purpose, code), expiresAt: new Date(Date.now() + CODE_LIFETIME) } }),
  ]);
  return code;
}

/** Once a link or a code has worked, its twin from the same email must not work as well. */
const retireCodes = (userId: string, purpose: CodePurpose) => db.authCode.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
const retireLinks = (userId: string, purpose: CodePurpose) => db.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });

/**
 * Checks the code someone typed for this email and, if right, uses it up and returns the user. Every try is counted before
 * the code is compared, so one code can only ever be guessed at CODE_TRIES times, however many requests arrive at once.
 * Wrong, expired, used and unknown all look the same (null).
 */
async function redeemCode(email: string, code: string, purpose: CodePurpose) {
  const user = await db.user.findFirst({ where: { email, active: true, deletedAt: null } });
  if (!user) return null;
  const row = await db.authCode.findFirst({ where: { userId: user.id, purpose, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  const tried = await db.authCode.updateMany({ where: { id: row.id, usedAt: null, attempts: { lt: CODE_TRIES } }, data: { attempts: { increment: 1 } } });
  if (tried.count !== 1) return null;
  const want = Buffer.from(row.codeHash);
  const got = Buffer.from(codeHash(user.id, purpose, code.replace(/\s/g, "")));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const used = await db.authCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) return null;
  await retireLinks(user.id, purpose);
  return user;
}

export type GymSignup = { plan: string; cycle: Cycle; name: string; email: string; phone: string; business: string; city?: string; password: string;
  gymEmail?: string; address?: string; state?: string; pin?: string; tagline?: string; website?: string; instagram?: string; logo?: File | null };

/**
 * Creates a gym on a free trial: the organisation, its first branch, default roles and
 * categories, and the owner as Super Admin. Then emails the owner a verification link.
 * Without an email service there is no way to deliver the link, so the address is trusted.
 */
/** `emailVerified`: Google has already confirmed the address, so no link is sent. */
export async function createGymAccount(d: GymSignup, emailVerified = false) {
  const plan = findPlan(d.plan);
  if (!plan || plan.product !== "GYM_ACCOUNTING") throw new UserError("Pick a Gym Accounting plan.", "plan");
  if (await db.user.findUnique({ where: { email: d.email } })) {
    throw new UserError("There's already an account with this email. Sign in, or reset your password.", "email");
  }
  // Check the logo first so a bad file fails before anything is created.
  let logo: { bytes: Uint8Array; mime: string; ext: string } | null = null;
  if (d.logo && d.logo.size > 0) {
    if (d.logo.size > MAX_LOGO_BYTES) throw new UserError("Logo must be under 1 MB.", "logo");
    const bytes = new Uint8Array(await d.logo.arrayBuffer());
    const type = sniffType(bytes);
    if (!type || (type.mime !== "image/png" && type.mime !== "image/jpeg")) throw new UserError("Use a PNG or JPG logo.", "logo");
    logo = { bytes, ...type };
  }
  const roles = await ensureRoles(db);
  await ensureExpenseCategories(db);
  const passwordHash = await hashPassword(d.password);
  const verifyNow = emailVerified || !emailReady();
  let user;
  try {
    user = await db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: d.business, plan: plan.key, planCycle: d.cycle, trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * HOUR) },
      });
      const address = [d.address, d.city, d.pin].filter(Boolean).join(", ") || (d.city ?? "");
      const branch = await tx.branch.create({ data: { orgId: org.id, name: "Main", address, phone: d.phone } });
      const gym = compact({ name: d.business, phone: d.phone, email: d.gymEmail, address: d.address, city: d.city, state: d.state, pin: d.pin, tagline: d.tagline, website: d.website, instagram: d.instagram });
      // The DPDP consent record: what was accepted, when and by whom.
      const legal = { tos: "v1", privacy: "v1", dpa: "v1", marketing: false, at: new Date().toISOString(), by: d.email };
      await tx.setting.create({ data: { orgId: org.id, key: "gym", value: gym } });
      await tx.setting.create({ data: { orgId: org.id, key: "legal", value: legal } });
      // The first-run setup (src/app/onboarding) is waiting for the owner; gyms set up by hand have no such setting.
      await tx.setting.create({ data: { orgId: org.id, key: "onboarding", value: { status: "PENDING" } } });
      const owner = await tx.user.create({
        data: {
          orgId: org.id,
          name: d.name,
          email: d.email,
          phone: d.phone,
          roleId: roles.get("Super Admin")!,
          passwordHash,
          emailVerifiedAt: verifyNow ? new Date() : null,
          branches: { create: [{ branchId: branch.id }] },
        },
      });
      await audit(tx, { orgId: org.id, userId: owner.id, action: "account.create", entity: "Organization", entityId: org.id, after: { plan: plan.key, cycle: d.cycle, gym, legal, via: emailVerified ? "google" : "email" } });
      return owner;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("There's already an account with this email. Sign in, or reset your password.", "email");
    throw e;
  }
  if (logo) {
    // The file needs the org id, so it goes up after the account exists. A failed upload never undoes the account.
    try {
      const key = `${user.orgId}/gym/logo-${randomUUID()}.${logo.ext}`;
      await putObject(key, logo.bytes, logo.mime);
      const row = await db.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: user.orgId, key: "gym" } } });
      await db.setting.update({ where: { orgId_key: { orgId: user.orgId, key: "gym" } }, data: { value: { ...(row.value as object), logoKey: key } } });
    } catch (e) {
      log.error("signup.logo_upload_failed", e);
    }
  }
  if (!verifyNow) await sendVerification(user.id);
  return { user, verified: verifyNow };
}

const compact = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;

/** A successful sign-in: stamps lastLoginAt and records how, in one transaction. */
/** `secondStep` says how a two-step sign-in finished: with an authenticator "code", or by using up a "recovery" code. */
export async function recordSignIn(userId: string, via: "email" | "google" | "email-link" | "email-code", secondStep?: "code" | "recovery") {
  await db.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await audit(tx, { orgId: u.orgId, userId, action: "auth.login", entity: "User", entityId: userId, after: secondStep ? { via, secondStep } : { via } });
  });
}

export async function sendVerification(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const link = `${appUrl()}/verify-email?token=${await issueToken(user.id, "VERIFY_EMAIL")}`;
  const code = await issueCode(user.id, "VERIFY_EMAIL");
  await sendEmail({
    to: user.email,
    subject: `${code} is your FITRON verification code`,
    text: `Hi ${user.name},\n\nYour code to confirm your email for FITRON: ${code}\nIt works for 10 minutes. Enter it on the page you signed up on.\n\nOr confirm with this link (it works for 48 hours):\n${link}\n\nIf you didn't sign up, ignore this email. Never share the code with anyone.\n\nFITRON\nhello@fitron.in`,
  });
}

/** Resends the link to an unverified address. Says nothing about whether the address exists. */
export async function resendVerification(email: string) {
  const user = await db.user.findFirst({ where: { email, active: true, deletedAt: null, emailVerifiedAt: null } });
  if (user) await sendVerification(user.id);
}

export async function verifyEmail(token: string) {
  const userId = await redeemToken(token, "VERIFY_EMAIL");
  if (!userId) return null;
  return db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
}

/** Confirms the address with the six-digit code from the sign-up email instead of the link. Null if the code is wrong, expired or used. */
export async function verifyEmailWithCode(email: string, code: string) {
  const user = await redeemCode(email, code, "VERIFY_EMAIL");
  return user ? db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() } }) : null;
}

/** Emails a reset link and code if the address belongs to an active account. Always looks the same to the caller. */
export async function requestPasswordReset(email: string) {
  const user = await db.user.findFirst({ where: { email, active: true, deletedAt: null } });
  if (!user) return;
  const link = `${appUrl()}/reset-password?token=${await issueToken(user.id, "RESET_PASSWORD")}`;
  const code = await issueCode(user.id, "RESET_PASSWORD");
  await sendEmail({
    to: user.email,
    subject: `${code} is your FITRON password reset code`,
    text: `Hi ${user.name},\n\nYour code to reset your FITRON password: ${code}\nIt works for 10 minutes. Enter it where you asked for the reset.\n\nOr choose a new password with this link (it works for 1 hour):\n${link}\n\nIf you didn't ask for this, ignore this email: your password stays the same. Never share the code with anyone.\n\nFITRON\nhello@fitron.in`,
  });
}

/** Sets the password and signs the user out everywhere. Reaching the inbox also proves the address, so it counts as verified. */
async function setNewPassword(userId: string, password: string) {
  const passwordHash = await hashPassword(password);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() } }),
    db.session.deleteMany({ where: { userId } }),
  ]);
  return user;
}

/** Sets a new password from a reset link and signs the user out everywhere. */
export async function resetPassword(token: string, password: string) {
  const userId = await redeemToken(token, "RESET_PASSWORD");
  if (!userId) throw new UserError("This link has expired or was already used. Ask for a new one.");
  return setNewPassword(userId, password);
}

/** The same, with the six-digit code from the reset email instead of the link. */
export async function resetPasswordWithCode(email: string, code: string, password: string) {
  const user = await redeemCode(email, code, "RESET_PASSWORD");
  if (!user) throw new UserError("That code is not right, or it has expired. Check it, or ask for a new one.", "code");
  return setNewPassword(user.id, password);
}

/**
 * Passwordless sign-in: emails a link and a six-digit code to an active account. Always looks the same to the caller.
 * Clicking or typing proves the address, like a reset does. Two-step sign-in (authenticator app) still applies afterwards.
 */
export async function requestSignInLink(email: string) {
  const user = await db.user.findFirst({ where: { email, active: true, deletedAt: null } });
  if (!user) return;
  const link = `${appUrl()}/login/email?token=${await issueToken(user.id, "LOGIN")}`;
  const code = await issueCode(user.id, "LOGIN");
  await sendEmail({
    to: user.email,
    subject: `${code} is your FITRON sign-in code`,
    text: `Hi ${user.name},\n\nYour FITRON sign-in code: ${code}\nIt works for 10 minutes. Enter it where you asked to sign in.\n\nOr open this link on the same device (it works for 15 minutes, once):\n${link}\n\nIf you didn't ask to sign in, ignore this email: nobody can get in without the code or the link. Never share the code with anyone.\n\nFITRON\nhello@fitron.in`,
  });
}

/** A signed-in-by-email user, or null for a code or link that is wrong, expired, used, or for an account since switched off. */
async function signedInByEmail(userId: string | null) {
  if (!userId) return null;
  const user = await db.user.findFirst({ where: { id: userId, active: true, deletedAt: null } });
  if (!user) return null;
  return user.emailVerifiedAt ? user : db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
}

export const redeemSignInLink = async (token: string) => signedInByEmail(await redeemToken(token, "LOGIN"));
export const redeemSignInCode = async (email: string, code: string) => signedInByEmail((await redeemCode(email, code, "LOGIN"))?.id ?? null);
