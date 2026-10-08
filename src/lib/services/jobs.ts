import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { getAutopayMode, runAutopayDay, syncWithRazorpay } from "./autopay";
import { razorpayReady } from "@/lib/integrations/razorpay";
import { alertRestoreTestFailed, backupNudge, createBackup, pruneBackups, testRestore } from "./backup";
import { sizeText } from "@/lib/domain/backup";
import { isUniqueViolation } from "./errors";
import { notify } from "./notifications";
import { sendMonthlyPl } from "./pl-email";
import { computeRisk, dailyBrief } from "./insights";
import { getAiSettings } from "./ai-settings";
import { systemUser } from "@/lib/auth/system";
import { syncDevices } from "./biometric";
import { runRetention } from "./privacy";
import { billingReminders } from "./saas";
import { fromIso, istInstant, toIso, todayIso } from "./time";
import { dispatchScheduled, runRules } from "./wa-automation";
import { getWaSettings, listTemplates, refreshQueued } from "./whatsapp";

type Result = Record<string, number | string>;
type Job = { name: string; label: string; run: (orgId: string, today: string, now: Date) => Promise<Result> };

/** Runs the rules of the templates that are on and trigger on one of `whens`, reporting sent / skipped / held. */
async function reminderRules(orgId: string, whens: string[], today: string, now: Date): Promise<Result> {
  const keys = (await listTemplates(orgId)).filter((t) => t.autoSend && whens.includes(t.ruleWhen)).map((t) => t.key);
  const r = await runRules(orgId, null, keys, today, now, null);
  return { sent: r.sent, skipped: r.skipped, held: r.held, ...(r.failed ? { failed: r.failed } : {}) };
}

export const JOBS: Job[] = [
  {
    name: "members.risk",
    label: "Churn risk for every member",
    run: (orgId, today) => computeRisk(orgId, today),
  },
  {
    name: "ai.brief",
    label: "Fitron AI daily brief",
    async run(orgId, today): Promise<Result> {
      const ai = await getAiSettings(orgId);
      if (!ai.enabled || !ai.dailyBrief) return { alerts: 0, note: "off" };
      const sys = await systemUser(orgId);
      const alerts = await dailyBrief(sys, today);
      if (alerts.length) {
        const n = alerts.length;
        let text = `Today's brief: ${alerts
          .slice(0, 3)
          .map((a) => a.title)
          .join(" · ")}${n > 3 ? ` and ${n - 3} more` : ""}`;
        if (ai.autoWinback && (await db.member.count({ where: { orgId, deletedAt: null, walkIn: false, suspended: false, riskScore: { gte: 60 } } }))) text += " · win-back message ready to review";
        await db.$transaction((tx) => notify(tx, { orgId, type: "AI_BRIEF", text, link: "/ai" }));
      }
      return { alerts: alerts.length };
    },
  },
  {
    name: "attendance.close",
    label: "Check out visits left open on earlier days",
    async run(orgId, today) {
      const open = await db.attendance.findMany({ where: { branch: { orgId }, checkOut: null, date: { lt: fromIso(today) } }, select: { id: true, date: true } });
      for (const a of open) await db.attendance.update({ where: { id: a.id }, data: { checkOut: istInstant(toIso(a.date), "22:00"), autoOut: true } });
      return { closed: open.length };
    },
  },
  {
    name: "reminders.expiry",
    label: "Expiry reminders on WhatsApp",
    run: (orgId, today, now) => reminderRules(orgId, ["before_expiry", "after_expiry"], today, now),
  },
  {
    name: "reminders.dues",
    label: "Payment reminders on WhatsApp",
    async run(orgId, today, now) {
      if (!(await getWaSettings(orgId)).dueEveryDays) return { sent: 0, skipped: 0, held: 0, note: "off" };
      return reminderRules(orgId, ["dues_age"], today, now);
    },
  },
  {
    name: "reminders.birthday",
    label: "Birthday wishes",
    async run(orgId, today, now) {
      if (!(await listTemplates(orgId)).some((t) => t.autoSend && t.ruleWhen === "birthday")) return { sent: 0, skipped: 0, held: 0, note: "off" };
      return reminderRules(orgId, ["birthday"], today, now);
    },
  },
  {
    name: "reminders.winback",
    label: "Win-back offers to members who stopped coming",
    run: (orgId, today, now) => reminderRules(orgId, ["no_visit"], today, now),
  },
  {
    name: "reminders.autopay",
    label: "Autopay debit notices from the rule",
    run: (orgId, today, now) => reminderRules(orgId, ["before_debit"], today, now),
  },
  {
    name: "autopay",
    label: "UPI Autopay demo debits",
    run: (orgId, today) => runAutopayDay(orgId, today),
  },
  {
    name: "autopay.sync",
    label: "Sync live mandates with Razorpay",
    run: async (orgId) => ((await getAutopayMode(orgId)) === "live" && !razorpayReady() ? syncWithRazorpay({ orgId }) : { skipped: 1 }),
  },
  {
    name: "leads.followup",
    label: "Lead follow-ups due",
    async run(orgId, today) {
      const due = await db.lead.groupBy({ by: ["branchId"], where: { orgId, stage: { notIn: ["Won", "Lost"] }, followUpOn: { lte: fromIso(today) } }, _count: { _all: true } });
      for (const b of due) {
        await db.$transaction((tx) => notify(tx, { orgId, branchId: b.branchId, type: "LEAD_FOLLOW_UP", text: `${b._count._all} lead${b._count._all === 1 ? "" : "s"} to follow up today.`, link: "/leads?due=1" }));
      }
      return { branches: due.length, leads: due.reduce((a, b) => a + b._count._all, 0) };
    },
  },
  {
    name: "devices.sync",
    label: "Load members onto door devices, remove expired ones",
    run: (orgId, today) => syncDevices(orgId, today),
  },
  {
    name: "privacy.retention",
    label: "Erase personal data of members whose retention period is over",
    run: async (orgId, today, now) => runRetention(await systemUser(orgId), today, now),
  },
  {
    name: "billing.branches",
    label: "Plan and branch renewal reminders",
    run: (orgId, today) => billingReminders(orgId, today),
  },
  {
    name: "whatsapp.refresh",
    label: "Delivery status from the linked phone",
    run: async (orgId) => ({ updated: await refreshQueued(orgId) }),
  },
  {
    name: "whatsapp.dispatch",
    label: "Send messages held by quiet hours",
    run: (orgId, _today, now) => dispatchScheduled(orgId, now),
  },
  {
    name: "backup.auto",
    label: "Backup of all data, kept 30 days",
    async run(orgId, _today, now) {
      const b = await createBackup({ orgId, userId: null }, "AUTO", now);
      const pruned = await pruneBackups(orgId, now);
      return { size: sizeText(b.size), pruned };
    },
  },
  {
    name: "backup.nudge",
    label: "Weekly backup reminder",
    run: (orgId, _today, now) => backupNudge(orgId, now),
  },
  {
    name: "reports.monthly",
    label: "Last month's profit and loss, emailed to the owner",
    run: (orgId, today, now) => sendMonthlyPl(orgId, today, now),
  },
];

/** The jobs that run once a week, in the quiet hours (the scheduler calls /api/jobs/weekly), not with the morning jobs. */
export const WEEKLY_JOBS: Job[] = [
  {
    name: "backup.test",
    label: "Test that the latest backup restores",
    async run(orgId, _today, now): Promise<Result> {
      let t;
      try {
        t = await testRestore(orgId, now);
      } catch (e) {
        await alertRestoreTestFailed(orgId, e instanceof Error ? e.message : String(e));
        throw e;
      }
      if (!t) return { note: "no backup yet" };
      return { backup: t.backup.fileName, taken: t.backup.createdAt.toISOString(), rows: t.rows, tables: t.tables, ms: t.ms };
    },
  },
];

/**
 * Runs every job of a list for one gym. Each job runs at most once per gym per day (JobRun is unique
 * on org + job + day); a job that failed is retried on the next call.
 */
async function runJobList(list: Job[], kind: string, orgId: string, today: string, now: Date) {
  const out: { name: string; status: "ran" | "skipped" | "failed"; result?: Result; error?: string }[] = [];
  for (const job of list) {
    let run;
    try {
      run = await db.jobRun.create({ data: { orgId, name: job.name, day: today } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const prev = await db.jobRun.findUniqueOrThrow({ where: { orgId_name_day: { orgId, name: job.name, day: today } } });
      if (!prev.error) {
        out.push({ name: job.name, status: "skipped" });
        continue;
      }
      run = await db.jobRun.update({ where: { id: prev.id }, data: { startedAt: new Date(), error: null, finishedAt: null } });
    }
    try {
      const result = await job.run(orgId, today, now);
      await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), result: result as Prisma.InputJsonValue } });
      out.push({ name: job.name, status: "ran", result });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error } });
      await db.$transaction((tx) => notify(tx, { orgId, type: "JOB_FAILED", text: `${kind} job "${job.label}" failed: ${error}`, link: "/settings/jobs" }));
      out.push({ name: job.name, status: "failed", error });
    }
  }
  return out;
}

export const runDailyJobs = (orgId: string, today = todayIso(), now = new Date()) => runJobList(JOBS, "Daily", orgId, today, now);

export const runWeeklyJobs = (orgId: string, today = todayIso(), now = new Date()) => runJobList(WEEKLY_JOBS, "Weekly", orgId, today, now);

export async function runAllGyms(today = todayIso(), now = new Date()) {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  const results = [];
  for (const o of orgs) results.push({ org: o.name, jobs: await runDailyJobs(o.id, today, now) });
  return results;
}

export async function runAllGymsWeekly(today = todayIso(), now = new Date()) {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  const results = [];
  for (const o of orgs) results.push({ org: o.name, jobs: await runWeeklyJobs(o.id, today, now) });
  return results;
}

/** Held messages for every gym, whenever the scheduler calls /api/jobs/dispatch. */
export async function dispatchAllGyms(now = new Date()) {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  const results = [];
  for (const o of orgs) results.push({ org: o.name, ...(await dispatchScheduled(o.id, now)) });
  return results;
}

export const recentRuns = (orgId: string) => db.jobRun.findMany({ where: { orgId }, orderBy: { startedAt: "desc" }, take: 60 });

