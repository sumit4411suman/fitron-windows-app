"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { remindAllOverdue, remindDue, remindRenewal, remindRenewals } from "@/lib/services/reminders";
import { UserError } from "@/lib/services/errors";
import { outcomeTone, sendOutcome, tallyText, tallyTone, type Outcome, type Tally } from "@/lib/domain/wa-outcome";

/** Back to the list, with the result shown at the top. Only same-app paths. */
function back(path: string, msg: string, tone: string): never {
  const to = path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
  revalidatePath(to.split("?")[0]!);
  redirect(`${to}${to.includes("?") ? "&" : "?"}${new URLSearchParams({ msg, tone })}`);
}

const RECENT = "Not sent: this member was reminded recently.";

async function run(path: string, fn: () => Promise<{ msg: string; tone: string }>) {
  let r: { msg: string; tone: string };
  try {
    r = await fn();
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    r = { msg: e.message, tone: "alert" };
  }
  back(path, r.msg, r.tone);
}

const one = (what: string, m: Outcome) => ({ msg: sendOutcome(what, m, RECENT), tone: outcomeTone(m) });
const many = (t: Tally) => ({ msg: tallyText(t), tone: tallyTone(t) });

export async function remindDueAction(memberId: string, invoiceNumber: string, path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => one("Payment reminder", await remindDue(u, memberId, invoiceNumber)));
}

export async function remindAllOverdueAction(path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => many(await remindAllOverdue(u)));
}

export async function remindRenewalAction(memberId: string, path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => one("Renewal reminder", await remindRenewal(u, memberId)));
}

export async function remindRenewalsAction(memberIds: string[], path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => many(await remindRenewals(u, memberIds.slice(0, 500))));
}
