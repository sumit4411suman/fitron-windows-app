import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/** Types and the permission a user needs to see them. */
export const NOTIFICATION_PERMS = {
  LOW_STOCK: "pos.sell",
  WAITLIST: "classes.manage",
  CHECKIN_OVERRIDE: "attendance.manage",
  LEAD_FOLLOW_UP: "leads.manage",
  WA_FAILED: "whatsapp.send",
  AUTOPAY: "autopay.manage",
  JOB_FAILED: "settings.manage",
  AI_BRIEF: "ai.use",
  BILLING: "settings.manage",
  BACKUP_DUE: "settings.manage",
} as const;
export type NotificationType = keyof typeof NOTIFICATION_PERMS;

export async function notify(tx: Tx, n: { orgId: string; branchId?: string | null; userId?: string | null; type: NotificationType; text: string; link?: string }) {
  await tx.notification.create({ data: { orgId: n.orgId, branchId: n.branchId ?? null, userId: n.userId ?? null, type: n.type, text: n.text, link: n.link ?? null } });
}

function scope(u: CurrentUser): Prisma.NotificationWhereInput {
  const types = (Object.keys(NOTIFICATION_PERMS) as NotificationType[]).filter((t) => u.can(NOTIFICATION_PERMS[t]));
  return {
    orgId: u.orgId,
    type: { in: types },
    AND: [{ OR: [{ branchId: null }, { branchId: { in: u.branchIds } }] }, { OR: [{ userId: null }, { userId: u.id }] }],
  };
}

export const unreadCount = (u: CurrentUser) => db.notification.count({ where: { ...scope(u), readAt: null } });

export const listNotifications = (u: CurrentUser) => db.notification.findMany({ where: scope(u), orderBy: { createdAt: "desc" }, take: 100 });

export async function markAllRead(u: CurrentUser) {
  await db.notification.updateMany({ where: { ...scope(u), readAt: null }, data: { readAt: new Date() } });
}

/** Marks one alert read and returns where it points, for "click to open". */
export async function openNotification(u: CurrentUser, id: string) {
  const n = await db.notification.findFirst({ where: { ...scope(u), id } });
  if (!n) return null;
  if (!n.readAt) await db.notification.update({ where: { id }, data: { readAt: new Date() } });
  return n.link;
}
