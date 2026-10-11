import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { getAutopayMode, runAutopayDay, syncWithRazorpay } from "./autopay";
import { razorpayReady } from "@/lib/integrations/razorpay";
import { alertRestoreTestFailed, backupNudge, createBackup, pruneBackups, testRestore } from "./backup";
import { sizeText } from "@/lib/domain/backup";
import { isUniqueViolation, NotNow } from "./errors";
import { gymAccountingOnly, isLocal } from "@/lib/runtime/edition";
import { offlineMessage, probablyOnline, SERVICE } from "@/lib/integrations/online";
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
import { getWaSettings, listTemplates, refreshQueued, whySendingFails } from "./whatsapp";

type Result = Record<string, number | string>;
type Job = { name: string; label: string; run: (orgId: string, today: string, now: Date) => Promise<Result> };

/**
 * On a computer (FITRON for Windows), a job that sends on WhatsApp waits until WhatsApp can take messages (the internet
 * for Meta's API, the connector running) instead of recording a failure for every member and alerting every hour.
 */
async function whatsAppOrLater(orgId: string) {
  if (!isLocal()) return;
  const why = await whySendingFails(orgId);
  if (why) throw new NotNow(why);
}

/** Runs the rules of the templates that are on and trigger on one of `whens`, reporting sent / skipped / held. */
async function reminderRules(orgId: string, whens: string[], today: string, now: Date): Promise<Result> {
  // On a computer with WhatsApp not linked, the timer saves nothing: saved-but-unsent reminders would only stop the
  // real ones once WhatsApp is linked (a member reminded recently is skipped). The desk can still remind by hand.
  if (gymAccountingOnly()) {
    const wa = await getWaSettings(orgId);
    if (wa.mode === "demo") return { sent: 0, skipped: 0, held: 0, note: "WhatsApp is not linked: nothing sent" };
    // Linked, but the gym has not chosen automatic messages (Settings › WhatsApp): only staff send.
    if (!wa.automatic) return { sent: 0, skipped: 0, held: 0, note: "automatic messages are off: nothing sent" };
  }
  await whatsAppOrLater(orgId);
  const keys = (await listTemplates(orgId)).filter((t) => t.autoSend && whens.includes(t.ruleWhen)).map((t) => t.key);
  const r = await runRules(orgId, null, keys, today, now, null);
  // "sent" is only what reached WhatsApp: a message saved in demo mode or queued on the phone is counted apart.
  return {
    sent: r.sent - r.logged - r.queued,
    skipped: r.skipped,
    held: r.held,
    ...(r.queued ? { "queued on the phone": r.queued } : {}),
    ...(r.logged ? { "saved, not sent (WhatsApp not linked)": r.logged } : {}),
    ...(r.failed ? { failed: r.failed } : {}),
  };
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
    async run(orgId) {
      if ((await getAutopayMode(orgId)) !== "live" || razorpayReady()) return { skipped: 1 };
      if (isLocal() && !(await probablyOnline(SERVICE.razorpay))) throw new NotNow(offlineMessage("Syncing with Razorpay"));
      return syncWithRazorpay({ orgId });
    },
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
    async run(orgId, _today, now) {
      await whatsAppOrLater(orgId);
      return dispatchScheduled(orgId, now);
    },
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
  const out: { name: string; status: "ran" | "skipped" | "failed" | "waiting"; result?: Result; error?: string }[] = [];
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
      // Waiting for the internet (or the connector): leave no run behind, so the next call tries again, and alert nobody.
      if (e instanceof NotNow) {
        await db.jobRun.delete({ where: { id: run.id } });
        out.push({ name: job.name, status: "waiting", error: e.message });
        continue;
      }
      const error = e instanceof Error ? e.message : String(e);
      await db.jobRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error } });
      await db.$transaction((tx) => notify(tx, { orgId, type: "JOB_FAILED", text: `${kind} job "${job.label}" failed: ${error}`, link: "/settings/jobs" }));
      out.push({ name: job.name, status: "failed", error });
    }
  }
  return out;
}

export const runDailyJobs = (orgId: string, today = todayIso(), now = new Date()) => runJobList(JOBS, "Daily", orgId, today, now);

/**
 * The daily jobs FITRON for Windows runs itself (src/lib/runtime/local-scheduler.ts): all but door devices (they cannot
 * reach a computer), FITRON's branch billing (a licence term there), the server's own backups and their reminder (the
 * computer makes .fitronbackup files on its own schedule), and the demo autopay debits: those book simulated UPI
 * payments, which a gym's real books must never get unasked. On a computer they run only from "Run today's debits".
 */
const NOT_ON_A_COMPUTER = new Set(["autopay", "devices.sync", "billing.branches", "backup.auto", "backup.nudge"]);
export const LOCAL_JOBS = JOBS.filter((j) => !NOT_ON_A_COMPUTER.has(j.name));
/**
 * While the computer is linked to fitron.in, the daily jobs run there, on the same records: running them here too would
 * send members every reminder twice and write every member's risk score on both sides each day.
 */
export const ON_FITRON_IN = "runs on fitron.in while this computer is linked";
const linkedToCloud = async () => isLocal() && !!(await db.syncState.findUnique({ where: { id: 1 }, select: { linked: true } }))?.linked;

export async function runLocalDailyJobs(orgId: string, today = todayIso(), now = new Date()) {
  if (await linkedToCloud()) return LOCAL_JOBS.map((j) => ({ name: j.name, status: "skipped" as const, result: { note: ON_FITRON_IN } as Result, error: undefined as string | undefined }));
  return runJobList(LOCAL_JOBS, "Daily", orgId, today, now);
}

/**
 * One pass of FITRON for Windows' timer, for every gym on the computer: today's jobs that are still due (each runs once
 * a day; one that waited for the internet runs once it is back), then messages held by quiet hours whose time has come.
 */
export async function runDueOnThisComputer(now = new Date(), only?: string[]) {
  const today = todayIso(now);
  const orgs = await db.organization.findMany({ where: only ? { id: { in: only } } : undefined, select: { id: true } });
  let ran = 0;
  let waiting = 0;
  for (const o of orgs) {
    const jobs = await runLocalDailyJobs(o.id, today, now);
    ran += jobs.filter((j) => j.status === "ran").length;
    waiting += jobs.filter((j) => j.status === "waiting").length;
    if (!(await linkedToCloud()) && !(await whySendingFails(o.id))) await dispatchScheduled(o.id, now);
  }
  return { gyms: orgs.length, ran, waiting };
}

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

