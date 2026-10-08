import "server-only";
import webpush from "web-push";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { trainerAccess } from "@/lib/domain/trainer";
import { dueReminders, type Reminder } from "@/lib/domain/trainer-reminders";
import { UserError } from "./errors";
import { fromIso, istClock, todayIso, toIso } from "./time";
import { log } from "@/lib/log";

// Web Push for the AI Trainer: reminders that reach the member's phone when the app is closed.
// Needs VAPID keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); without them the app keeps its in-page
// reminders only. An hourly job (GET /api/jobs/trainer) sends whatever is due.

const keys = () => ({ publicKey: process.env.VAPID_PUBLIC_KEY?.trim() ?? "", privateKey: process.env.VAPID_PRIVATE_KEY?.trim() ?? "" });
export const pushReady = () => !!(keys().publicKey && keys().privateKey);
export const pushPublicKey = () => (pushReady() ? keys().publicKey : null);

let configured = false;
function client() {
  if (!configured) {
    const k = keys();
    webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || "mailto:hello@fitron.in", k.publicKey, k.privateKey);
    configured = true;
  }
  return webpush;
}

export type PushSubscriptionInput = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

/** Keeps a device's push subscription for the member (the same endpoint moving between accounts follows the newest sign-in). */
export async function savePush(memberId: string, sub: PushSubscriptionInput, userAgent?: string | null) {
  const endpoint = String(sub?.endpoint ?? "");
  const p256dh = String(sub?.keys?.p256dh ?? "");
  const auth = String(sub?.keys?.auth ?? "");
  if (!/^https:\/\/\S{10,2000}$/.test(endpoint) || !p256dh || !auth || p256dh.length > 300 || auth.length > 100) throw new UserError("That push subscription isn't valid.");
  if (!pushReady()) throw new UserError("Push reminders aren't set up on this server yet.");
  const data = { memberId, p256dh, auth, userAgent: userAgent?.slice(0, 200) ?? null, failures: 0, lastUsedAt: new Date() };
  return db.trainerPush.upsert({ where: { endpoint }, create: { endpoint, ...data }, update: data });
}

export async function removePush(memberId: string, endpoint: string) {
  await db.trainerPush.deleteMany({ where: { memberId, endpoint: String(endpoint ?? "") } });
}

type Row = { id: string; endpoint: string; p256dh: string; auth: string; failures: number };

/** One push to one device: "sent", "failed" (kept, counted), or "gone" (the subscription was removed). */
async function deliver(p: Row, r: Omit<Reminder, "key"> & { tag: string }): Promise<"sent" | "failed" | "gone"> {
  try {
    await client().sendNotification({ endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } }, JSON.stringify(r), { TTL: 3600, urgency: "normal" });
    if (p.failures) await db.trainerPush.update({ where: { id: p.id }, data: { failures: 0 } });
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    // 404/410: the browser dropped the subscription. Anything else ten times running: give up on the device.
    if (status === 404 || status === 410 || p.failures + 1 >= 10) {
      await db.trainerPush.delete({ where: { id: p.id } }).catch(() => {});
      return "gone";
    }
    await db.trainerPush.update({ where: { id: p.id }, data: { failures: { increment: 1 } } }).catch(() => {});
    log.warn("trainer_push.failed", e, { status });
    return "failed";
  }
}

/** "Reminders are on": sent as soon as a device subscribes, so the member sees it works. */
export async function sendWelcomePush(memberId: string, endpoint: string) {
  const p = await db.trainerPush.findFirst({ where: { memberId, endpoint } });
  if (!p) return false;
  return (await deliver(p, { tag: "welcome", title: "Reminders are on", body: "FITRON will nudge you for workouts, meals, water and sleep, the way you set them.", url: "/trainer" })) === "sent";
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Sends every reminder that is due now to every subscribed device. Safe to call as often as every
 * few minutes: each reminder goes once a day per device.
 */
export async function sendTrainerReminders(now = new Date()) {
  if (!pushReady()) return { ready: false, devices: 0, sent: 0, removed: 0 };
  const today = todayIso(now);
  const clock = istClock(now);
  const pushes = await db.trainerPush.findMany({
    where: { member: { deletedEmailHash: null, onboardedAt: { not: null } } },
    include: {
      member: {
        include: {
          days: { where: { date: fromIso(today) }, take: 1 },
        },
      },
    },
  });
  let sent = 0;
  let removed = 0;
  for (const p of pushes) {
    const m = p.member;
    const profile = (m.profile ?? {}) as Record<string, unknown>;
    const ob = (profile.ob ?? {}) as Record<string, unknown>;
    const split = (profile.plan ?? {}) as Record<string, string>;
    const schedule = Array.isArray(profile.schedule) ? (profile.schedule as { key?: string; label?: string; time?: string }[]) : [];
    const workout = schedule.find((s) => s.key === "workout") ?? schedule.find((s) => /workout|training|gym/i.test(s.label ?? ""));
    const day = m.days[0];
    const due = dueReminders({
      today,
      clock,
      prefs: (profile.reminders ?? {}) as Record<string, boolean>,
      notificationsOn: profile.notificationsOn !== false,
      focusMode: !!profile.focusMode,
      focus: split[DAY[new Date(now.getTime() + 330 * 60_000).getUTCDay()]!] ?? null,
      workoutTime: workout?.time ?? null,
      access: trainerAccess({ paidUntil: m.paidUntil ? toIso(m.paidUntil) : null, trialEndsAt: m.trialEndsAt }, today, now),
      planCancelled: m.planCancelled,
      workoutDone: !!day?.workoutDone,
      water: day?.water ?? 0,
      waterGoal: parseFloat(String(ob.water ?? "")) || 3,
      sent: (p.sent ?? {}) as Record<string, string>,
    });
    if (!due.length) continue;
    const sentMap = { ...((p.sent ?? {}) as Record<string, string>) };
    let outcome: "sent" | "failed" | "gone" = "sent";
    for (const r of due) {
      outcome = await deliver(p, { tag: r.key, title: r.title, body: r.body, url: r.url });
      if (outcome !== "sent") break;
      sent++;
      sentMap[r.key] = today;
    }
    if (outcome === "gone") removed++;
    else if (outcome === "sent") await db.trainerPush.update({ where: { id: p.id }, data: { sent: sentMap as Prisma.InputJsonValue, lastUsedAt: now } }).catch(() => {});
  }
  return { ready: true, devices: pushes.length, sent, removed };
}
