import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { fromIso, todayIso } from "./time";

// AI Trainer members sign in separately from gym staff: their own cookie, their own session table.

export const TRAINER_COOKIE = "fitron_trainer";
const SESSION_DAYS = 90;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createTrainerSession(memberId: string) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.trainerSession.create({
    data: { id: sha256(token), memberId, expiresAt, ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: h.get("user-agent")?.slice(0, 300) ?? null },
  });
  await db.trainerMember.update({ where: { id: memberId }, data: { lastSeenAt: new Date() } });
  (await cookies()).set(TRAINER_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
}

/** The signed-in trainer member, or null. Expired sessions are removed. */
export async function currentTrainer() {
  const token = (await cookies()).get(TRAINER_COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const s = await db.trainerSession.findUnique({ where: { id }, include: { member: true } });
  if (!s) return null;
  const now = Date.now();
  if (s.expiresAt.getTime() < now) {
    await db.trainerSession.delete({ where: { id } }).catch(() => {});
    return null;
  }
  if (now - s.lastSeenAt.getTime() > 60_000) {
    await db.trainerSession.update({ where: { id }, data: { lastSeenAt: new Date(now) } }).catch(() => {});
    await db.trainerMember.update({ where: { id: s.memberId }, data: { lastSeenAt: new Date(now) } }).catch(() => {});
  }
  return currentPlan(s.member);
}

/**
 * A move down to AI Pro is confirmed to start after the AI Premium time already paid for (see
 * activateTrainerPaymentIn). Once that day comes, the member's saved plan follows the latest payment.
 */
export async function currentPlan<M extends { id: string; plan: string }>(m: M): Promise<M> {
  if (m.plan !== "ai-premium") return m;
  const latest = await db.trainerPayment.findFirst({ where: { memberId: m.id, status: "PAID" }, orderBy: { paidAt: "desc" }, select: { plan: true, periodStart: true } });
  if (latest?.plan !== "ai-pro" || !latest.periodStart || latest.periodStart > fromIso(todayIso())) return m;
  await db.trainerMember.update({ where: { id: m.id }, data: { plan: "ai-pro" } });
  return { ...m, plan: "ai-pro" };
}

export async function endTrainerSession() {
  const store = await cookies();
  const token = store.get(TRAINER_COOKIE)?.value;
  if (token) await db.trainerSession.delete({ where: { id: sha256(token) } }).catch(() => {});
  store.delete(TRAINER_COOKIE);
}
