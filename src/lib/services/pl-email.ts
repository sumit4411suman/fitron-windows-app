import "server-only";
import { jsonPath } from "@/lib/db-dialect";
import { db } from "@/lib/db";
import { emailReachable, emailReady, sendEmail } from "@/lib/integrations/email";
import { log } from "@/lib/log";
import { systemUser } from "@/lib/auth/system";
import { planHas } from "@/lib/domain/features";
import { monthToReport, plEmail, plSheet } from "@/lib/domain/pl-email";
import { monthLabel } from "@/lib/domain/periods";
import { buildXlsx, XLSX_MIME } from "@/lib/xlsx";
import { appUrl } from "./accounts";
import { monthPeriod, profitAndLoss } from "./accounting";
import { gymNameOf } from "./support";
import { gymPlan } from "./saas";
import { getSetting } from "./settings";
import { gymAccountingOnly, isLocal } from "@/lib/runtime/edition";
import { OfflineError, offlineMessage } from "@/lib/integrations/online";
import { NotNow } from "./errors";

// The first days of each month, the Super Admins of a gym with accounting get last month's profit and loss by email, with
// the statement as an Excel file. It is a daily job; it knows when it has already done the month.

export type ReportSettings = { monthlyPl?: boolean };

/**
 * Whether the gym wants it. On the Cloud Edition it is on unless switched off in Settings › Reminders. FITRON for Windows
 * sends the gym's figures out by email only once a gym user ticks it there: off until then.
 */
export async function monthlyPlOn(orgId: string) {
  const v = (await getSetting<ReportSettings>(orgId, "reports"))?.monthlyPl;
  return typeof v === "boolean" ? v : !gymAccountingOnly();
}

type Result = Record<string, number | string>;

export async function sendMonthlyPl(orgId: string, today: string, now: Date): Promise<Result> {
  const month = monthToReport(today);
  if (!month) return { sent: 0, note: "not the first days of the month" };
  if (!(await monthlyPlOn(orgId))) return { sent: 0, note: "off" };

  // The plan gates people elsewhere (the system user can do everything), so the gym's own plan is read here.
  const plan = await gymPlan(orgId, today);
  if (plan.standing.kind === "LAPSED") return { sent: 0, note: "plan ended" };
  if (!planHas({ key: plan.key, name: plan.name, custom: plan.terms.custom }, "accounting")) return { sent: 0, note: "not on the plan" };

  const done = await db.jobRun.findFirst({ where: { orgId, name: "reports.monthly", error: null, finishedAt: { not: null }, result: { path: jsonPath(["month"]), equals: month } }, select: { id: true } });
  if (done) return { sent: 0, month, note: "already sent" };

  const owners = await db.user.findMany({ where: { orgId, active: true, deletedAt: null, role: { name: "Super Admin" }, email: { not: "" } }, select: { name: true, email: true }, orderBy: { createdAt: "asc" } });
  if (!owners.length) return { sent: 0, note: "no owner with an email" };

  const sys = await systemUser(orgId);
  const pl = await profitAndLoss(sys, monthPeriod(month));
  if (!pl.totalRevenue && !pl.totalExpenses && !pl.collected && !pl.depreciation && !pl.disposalGain && !pl.disposalLoss) return { sent: 0, note: "nothing happened that month" };

  // Without a mail server the message would only be logged; leave the month open for when there is one.
  if (!emailReady()) return { sent: 0, note: "email is not set up on this server" };
  // A computer with no internet: wait for it (the month stays open), rather than fail every owner's address.
  if (isLocal() && !(await emailReachable())) throw new NotNow(offlineMessage("Emailing the monthly profit and loss"));

  const gym = await gymNameOf(sys);
  const file = buildXlsx(plSheet(month, pl), { title: `${gym}: profit and loss, ${monthLabel(month)}`, now });
  const attachment = { filename: `profit-and-loss_${month}.xlsx`, content: file, contentType: XLSX_MIME };
  const settingsUrl = `${appUrl()}/settings?tab=reminders`;

  let sent = 0;
  let failed = 0;
  for (const o of owners) {
    try {
      await sendEmail({ to: o.email, ...plEmail({ gym, month, name: o.name, pl, settingsUrl }), attachments: [attachment] });
      sent++;
    } catch (e) {
      // The internet went before anyone got it: wait for it, as when it was gone from the start.
      if (e instanceof OfflineError && !sent) throw new NotNow(e.message);
      failed++;
      log.error("pl_email.failed", e, { orgId });
    }
  }
  // Every address failing is the job's failure: the owner is told in the app, and tomorrow's run tries again.
  if (!sent) throw new Error("The monthly profit and loss email could not be sent. Check the mail server settings.");
  return { sent, ...(failed ? { failed } : {}), month };
}
