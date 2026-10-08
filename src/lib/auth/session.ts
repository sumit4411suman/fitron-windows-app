import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "@/lib/db";
import type { Session } from "@/generated/prisma/client";
import { sessionAlive } from "@/lib/domain/security";
import { getIdleMinutes } from "@/lib/services/settings";
import { audit } from "@/lib/services/audit";

export const SESSION_COOKIE = "fitron_session";
const SESSION_DAYS = 30;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  // Rotate: a fresh id on every sign-in.
  await db.session.create({
    data: {
      id: sha256(token),
      userId,
      expiresAt,
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
    },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * The signed-in user's session, with why it ended when it did. Expired sessions are removed;
 * idle ones (Settings › Go live › Security, default 30 minutes) are removed and audited.
 */
export const sessionCheck = cache(async (): Promise<{ session: Session | null; endedBy: "idle" | "expired" | null; idleMinutes: number }> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { session: null, endedBy: null, idleMinutes: 0 };
  const id = sha256(token);
  const session = await db.session.findUnique({ where: { id }, include: { user: { select: { orgId: true } } } });
  if (!session) return { session: null, endedBy: null, idleMinutes: 0 };
  const idleMinutes = await getIdleMinutes(session.user.orgId);
  const now = Date.now();
  const state = sessionAlive(session, now, idleMinutes);
  if (state !== "ok") {
    await db.session.delete({ where: { id } }).catch(() => {});
    if (state === "idle") {
      await db
        .$transaction((tx) => audit(tx, { orgId: session.user.orgId, userId: session.userId, action: "auth.idle-signout", entity: "Session", entityId: session.id, after: { idleMinutes } }))
        .catch(() => {});
    }
    return { session: null, endedBy: state, idleMinutes };
  }
  // Touch at most once a minute.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id }, data: { lastSeenAt: new Date(now) } }).catch(() => {});
  }
  const row: Session = { ...session, user: undefined } as Session & { user?: unknown };
  delete (row as { user?: unknown }).user;
  return { session: row, endedBy: null, idleMinutes };
});

/** Returns the signed-in user's session row, or null. Expired and idle sessions are removed. */
export const readSession = async () => (await sessionCheck()).session;

/** Idle sign-out asked for by the browser: audits it, then ends the session. */
export async function idleSignOut(minutes: number) {
  const { session } = await sessionCheck();
  if (session) {
    const user = await db.user.findUnique({ where: { id: session.userId }, select: { orgId: true } });
    if (user) await db.$transaction((tx) => audit(tx, { orgId: user.orgId, userId: session.userId, action: "auth.idle-signout", entity: "Session", entityId: session.id, after: { idleMinutes: minutes, by: "browser" } })).catch(() => {});
  }
  await destroySession();
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.session.delete({ where: { id: sha256(token) } }).catch(() => {});
  store.delete(SESSION_COOKIE);
}
