"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import "@/lib/zod-config";
import { requireFeature, requirePermission } from "@/lib/auth/current";
import { formAction, simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { editRule, getWaSettings, refreshQueued, sendCampaign, sendTemplate, setAutoSend, updateTemplate } from "@/lib/services/whatsapp";
import { runAutomationNow, runOne, type RunResult } from "@/lib/services/wa-automation";
import { fmtTime } from "@/lib/format";
import { audienceIds, type Audience } from "@/lib/services/audience";
import { UserError } from "@/lib/services/errors";

const templateInput = z.object({
  body: z.string().trim().min(5, { error: "Write the message." }).max(1000),
  metaTemplateName: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().regex(/^[a-z0-9_]+$/, { error: "Meta template names use lowercase letters, digits and _." }).optional()),
  language: z.string().trim().min(2).max(10),
  autoSend: z.preprocess((v) => v === "on", z.boolean()),
});

export async function saveTemplateAction(key: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("settings.manage");
  const r = await formAction(fd, templateInput, (d) => updateTemplate(u, key, d), "Template saved.");
  revalidatePath("/whatsapp/templates");
  revalidatePath("/whatsapp");
  return r;
}

export async function sendOneAction(memberId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("whatsapp.send");
  const key = String(fd.get("key") ?? "campaign");
  const body = String(fd.get("body") ?? "").trim();
  const invoiceId = String(fd.get("invoiceId") ?? "") || undefined;
  let status = "";
  const r = await simpleAction(async () => {
    if (key === "campaign" && body.length < 3) throw new UserError("Write the message.");
    const m = await sendTemplate({ orgId: u.orgId, memberId, key, userId: u.id, force: true, body: key === "campaign" ? body : undefined, invoiceId });
    if (!m) throw new UserError("Nothing was sent.");
    if (m.status === "Failed") throw new UserError(`Not sent: ${m.error}`);
    status = m.status;
  }, "");
  revalidatePath(`/members/${memberId}`);
  revalidatePath("/whatsapp");
  return r?.ok ? { ...r, message: status === "Logged" ? "Logged (demo mode, not sent)." : status === "Queued" ? "Queued on the linked phone." : "Sent." } : r;
}

export async function campaignAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("whatsapp.send");
  const audience = String(fd.get("audience") ?? "") as Audience;
  const body = String(fd.get("body") ?? "");
  let summary = "";
  const r = await simpleAction(async () => {
    const ids = await audienceIds(u, audience);
    if (!ids.length) throw new UserError("Nobody matches that group.");
    const res = await sendCampaign(u, ids, body);
    const mode = (await getWaSettings(u.orgId)).mode;
    summary = `${res.sent} ${mode === "demo" ? "logged (demo mode, not sent)" : mode === "connector" ? "queued on the linked phone" : "sent"}${res.failed ? `, ${res.failed} failed` : ""}.`;
  }, "");
  revalidatePath("/whatsapp");
  return r?.ok ? { ...r, message: summary } : r;
}

export async function refreshAction() {
  const u = await requirePermission("whatsapp.send");
  await refreshQueued(u.orgId);
  revalidatePath("/whatsapp");
}

/** Automation is a Super Admin's call (settings.manage) on a plan with WhatsApp. */
async function automationUser() {
  await requirePermission("settings.manage");
  return requireFeature("whatsapp");
}

/** The Auto-send checkbox on a template card. */
export async function toggleAutoSendAction(key: string, on: boolean) {
  const u = await automationUser();
  await setAutoSend(u, key, on).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  revalidatePath("/whatsapp");
}

/** The prototype's toast after a run: "2 automated messages sent · 1 skipped by rules". */
const runSummary = (r: RunResult) =>
  `${r.sent} automated message${r.sent === 1 ? "" : "s"} sent${r.skipped ? ` · ${r.skipped} skipped by rules` : ""}${r.held ? ` · ${r.held} held until ${fmtTime(r.heldUntil)}` : ""}`;

/** "Send N due now" in Today's automation. Inside quiet hours nothing goes out and the page says why. */
export async function runAutomationAction() {
  const u = await automationUser();
  let r: RunResult;
  try {
    r = await runAutomationNow(u);
  } catch (e) {
    if (e instanceof UserError) redirect(`/whatsapp?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/whatsapp");
  redirect(`/whatsapp?msg=${encodeURIComponent(runSummary(r))}`);
}

const ruleInput = z.object({
  when: z.string(),
  days: z.string().optional(),
  time: z.string().optional(),
  planId: z.string().optional(),
  gender: z.string().optional(),
  minDue: z.preprocess((v) => (v === "" || v == null ? 0 : v), z.coerce.number().min(0, { error: "Enter a balance of ₹0 or more." }).max(10_000_000)),
  maxPerWeek: z.string().optional(),
  quietFrom: z.string().optional(),
  quietTo: z.string().optional(),
  excludeAutopay: z.preprocess((v) => v === "on", z.boolean()),
});

/** "Save rule" in the Edit rule dialog. */
export async function saveRuleAction(key: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await automationUser();
  const r = await formAction(fd, ruleInput, (d) => editRule(u, key, { ...d, minDue: Math.round(d.minDue * 100) }), "Automation rule saved");
  if (!r?.ok) return r;
  revalidatePath("/whatsapp");
  revalidatePath("/whatsapp/templates");
  redirect(`/whatsapp?msg=${encodeURIComponent("Automation rule saved")}`);
}

/** "Send to N now" in Preview & run. */
export async function runRuleAction(key: string) {
  const u = await automationUser();
  let r: RunResult;
  try {
    r = await runOne(u, key);
  } catch (e) {
    if (e instanceof UserError) redirect(`/whatsapp?preview=${encodeURIComponent(key)}&err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/whatsapp");
  redirect(`/whatsapp?msg=${encodeURIComponent(runSummary(r))}`);
}

/** "Retry" on a failed message in the log: sends the same text to the member again. */
export async function retryMessageAction(id: string) {
  const u = await requirePermission("whatsapp.send");
  const m = await db.whatsAppMessage.findFirst({ where: { id, orgId: u.orgId, status: "Failed", member: { branchId: { in: u.branchIds } } } });
  let msg = "Message not found.";
  if (m?.memberId) {
    const again = await sendTemplate({ orgId: u.orgId, memberId: m.memberId, key: m.templateKey, userId: u.id, force: true, body: m.body });
    msg = !again ? "Nothing was sent." : again.status === "Failed" ? `Still failing: ${again.error}` : "Sent again.";
  }
  revalidatePath("/whatsapp");
  redirect(`/whatsapp?tab=log&msg=${encodeURIComponent(msg)}`);
}
