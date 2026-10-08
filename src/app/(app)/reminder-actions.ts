"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { remindAllOverdue, remindDue, remindRenewal, remindRenewals } from "@/lib/services/reminders";
import { UserError } from "@/lib/services/errors";

/** Back to the list, with the result shown at the top. Only same-app paths. */
function back(path: string, msg: string): never {
  const to = path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
  revalidatePath(to.split("?")[0]!);
  redirect(`${to}${to.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`);
}

const summary = (r: { sent: number; skipped: number }) =>
  `${r.sent} reminder${r.sent === 1 ? "" : "s"} sent on WhatsApp${r.skipped ? ` · ${r.skipped} skipped (reminded recently or no number)` : ""}.`;

async function run(path: string, fn: () => Promise<string>) {
  let msg: string;
  try {
    msg = await fn();
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    msg = e.message;
  }
  back(path, msg);
}

export async function remindDueAction(memberId: string, invoiceNumber: string, path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => ((await remindDue(u, memberId, invoiceNumber)) ? "Payment reminder sent on WhatsApp." : "Not sent: this member was reminded recently."));
}

export async function remindAllOverdueAction(path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => summary(await remindAllOverdue(u)));
}

export async function remindRenewalAction(memberId: string, path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => ((await remindRenewal(u, memberId)) ? "Renewal reminder sent on WhatsApp." : "Not sent: this member was reminded recently."));
}

export async function remindRenewalsAction(memberIds: string[], path: string) {
  const u = await requirePermission("whatsapp.send");
  await run(path, async () => summary(await remindRenewals(u, memberIds.slice(0, 500))));
}
