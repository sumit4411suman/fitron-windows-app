"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { changeMandate, createMandate, getAutopayMode, getAutopaySettings, retryDemoDebit, retryLiveDebit, runAutopayDay, syncOrExplain } from "@/lib/services/autopay";
import { runRules } from "@/lib/services/wa-automation";
import { fmtDate } from "@/lib/format";
import { toIso } from "@/lib/services/time";
import { db } from "@/lib/db";
import { resolveMemberRef } from "@/lib/services/members";
import { UserError } from "@/lib/services/errors";

export async function createAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("autopay.manage");
  let id = "";
  const r = await simpleAction(async () => {
    const m = await resolveMemberRef(u, String(fd.get("member") ?? ""));
    if (!m) throw new UserError("Pick a member from the list.");
    const start = String(fd.get("startOn") ?? "") || undefined;
    if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new UserError("Pick the first debit date.");
    id = (await createMandate(u, { memberId: m.id, planId: String(fd.get("planId") ?? ""), startOn: start, vpa: String(fd.get("vpa") ?? "") })).id;
  }, "");
  if (!r?.ok) return r;
  revalidatePath("/autopay");
  redirect(`/autopay/${id}`);
}

export async function changeAction(id: string, action: "pause" | "resume" | "cancel" | "approve-demo"): Promise<FormState> {
  const u = await requirePermission("autopay.manage");
  const r = await simpleAction(() => changeMandate(u, id, action), "Done.");
  revalidatePath(`/autopay/${id}`);
  revalidatePath("/autopay");
  return r;
}

const back = (msg: string, f?: string) => redirect(`/autopay?${f ? `f=${encodeURIComponent(f)}&` : ""}msg=${encodeURIComponent(msg)}`);
const said = async (fn: () => Promise<string>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserError) return e.message;
    throw e;
  }
};

/** The table's row buttons: Approve now, Pause / Resume, Cancel. */
export async function rowAction(id: string, action: "pause" | "resume" | "cancel" | "approve-demo", f: string) {
  const u = await requirePermission("autopay.manage");
  const msg = await said(async () => {
    await changeMandate(u, id, action);
    return { pause: "Autopay paused.", resume: "Autopay resumed.", cancel: "Autopay cancelled.", "approve-demo": "Mandate approved." }[action];
  });
  revalidatePath("/autopay");
  back(msg, f);
}

/** "Retry now": a simulated debit in demo mode, Razorpay in live mode. */
export async function retryAction(id: string, f: string) {
  const u = await requirePermission("autopay.manage");
  const msg = await said(async () => {
    const m = await db.autopayMandate.findFirst({ where: { id, orgId: u.orgId, branchId: { in: u.branchIds } }, include: { member: { select: { name: true } } } });
    if (m?.mode === "live") return retryLiveDebit(u, id);
    const r = await retryDemoDebit(u, id);
    const name = m?.member.name ?? "Member";
    const max = (await getAutopaySettings(u.orgId)).retries;
    if (r.result === "renewed") {
      const a = await db.autopayMandate.findUniqueOrThrow({ where: { id } });
      return `Debit succeeded. ${name} renewed till ${fmtDate(a.nextDebitOn ? toIso(new Date(a.nextDebitOn.getTime() - 86400000)) : null)} (${a.lastResult?.match(/\(([^)]+)\)/)?.[1] ?? "invoice"}).`;
    }
    if (r.result === "failed") return `${name}: debit failed (${r.reason}). Retry ${r.retries} of ${max} on ${fmtDate(r.nextRetryOn)}.`;
    if (r.result === "halted") return `${name}: debit failed (${r.reason}) · ${max} retries used. Autopay halted — collect manually.`;
    return "Nothing to retry.";
  });
  revalidatePath("/autopay");
  back(msg, f);
}

/** "Sync with Razorpay": live mode pulls subscription status and charges; demo mode says what it would do. */
export async function syncAction(f: string) {
  const u = await requirePermission("autopay.manage");
  const msg = await said(() => syncOrExplain(u));
  revalidatePath("/autopay");
  back(msg, f);
}

/** "Run today's debits" (demo mode): the daily job's notices and debits, on demand. */
export async function runDueAction() {
  const u = await requirePermission("autopay.manage");
  if ((await getAutopayMode(u.orgId)) !== "demo") back("Live debits are run by Razorpay.");
  const r = await runAutopayDay(u.orgId);
  // The day-ahead notice is the "Autopay debit notice" template's rule; held messages wait for quiet hours to end.
  const n = await runRules(u.orgId, null, ["autopay"], undefined, undefined, { userId: u.id });
  revalidatePath("/autopay");
  back(`${r.charged} debit${r.charged === 1 ? "" : "s"} collected · ${n.sent} pre-debit notice${n.sent === 1 ? "" : "s"} sent${n.held ? ` · ${n.held} held` : ""}.`);
}
