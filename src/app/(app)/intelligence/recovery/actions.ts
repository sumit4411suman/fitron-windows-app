"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { formAction, simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { attemptInput, casePaymentInput, closeCaseInput, recoveryRulesInput } from "@/lib/validation/intelligence";
import { closeCase, logAttempt, recordCasePayment, refreshQueue, reopenCase, saveRecoveryRules, sendCaseReminder } from "@/lib/services/recovery";

const done = (id?: string) => {
  revalidatePath("/intelligence/recovery");
  if (id) revalidatePath(`/intelligence/recovery/${id}`);
};

export async function refreshQueueAction(): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  const r = await simpleAction(async () => {
    const x = await refreshQueue(u);
    return x;
  }, "Queue brought up to date with the books.");
  done();
  return r;
}

export async function saveRulesAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("settings.manage");
  const r = await formAction(fd, recoveryRulesInput, async (d) => {
    await saveRecoveryRules(u, d);
    await refreshQueue(u);
  }, "Rules saved and the queue refreshed.");
  done();
  return r;
}

export async function logAttemptAction(caseId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  const r = await formAction(fd, attemptInput, (d) => logAttempt(u, caseId, d), "Recorded.");
  done(caseId);
  return r;
}

export async function sendReminderAction(caseId: string): Promise<FormState> {
  const u = await requirePermission("whatsapp.send");
  const r = await simpleAction(async () => {
    const x = await sendCaseReminder(u, caseId);
    if (x.outcome === "SKIPPED") throw new (await import("@/lib/services/errors")).UserError("Not sent: this member was reminded recently (Settings › Reminders sets how often).");
    if (x.outcome === "FAILED") throw new (await import("@/lib/services/errors")).UserError(x.message?.error ?? "The message failed.");
  }, "Reminder sent through WhatsApp (or saved, in demo mode).");
  done(caseId);
  return r;
}

export async function recordPaymentAction(caseId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("payments.collect");
  const r = await formAction(fd, casePaymentInput, (d) => recordCasePayment(u, caseId, d), "Payment recorded against the invoice.");
  done(caseId);
  revalidatePath("/receivables");
  return r;
}

export async function closeCaseAction(caseId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  const r = await formAction(fd, closeCaseInput, (d) => closeCase(u, caseId, d.reason), "Case closed.");
  done(caseId);
  return r;
}

export async function reopenCaseAction(caseId: string): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  const r = await simpleAction(() => reopenCase(u, caseId), "Case reopened.");
  done(caseId);
  return r;
}
