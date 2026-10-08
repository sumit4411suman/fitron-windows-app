"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { formAction, simpleAction } from "@/lib/form-action";
import { leadInput, type LeadStage } from "@/lib/validation/frontdesk";
import type { FormState } from "@/lib/validation/common";
import { createLead, setLeadStage, touchLead, updateLead } from "@/lib/services/leads";
import { UserError } from "@/lib/services/errors";

export async function saveLead(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("leads.manage");
  let newId = id;
  const r = await formAction(fd, leadInput, async (d) => {
    if (id) await updateLead(u, id, d);
    else newId = (await createLead(u, d)).id;
  }, "Lead saved.");
  if (!r?.ok) return r;
  revalidatePath("/leads");
  if (!id) redirect(`/leads/${newId}`);
  return r;
}

export async function stageAction(id: string, stage: LeadStage, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("leads.manage");
  const r = await simpleAction(() => setLeadStage(u, id, stage, { lostReason: (fd.get("reason") as string) || undefined, trialOn: (fd.get("trialOn") as string) || undefined }), `Moved to ${stage}.`);
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  return r;
}

const NEXT: Partial<Record<LeadStage, LeadStage>> = { New: "Contacted", Contacted: "Trial booked", "Trial booked": "Trial done" };

/** The board's buttons: call or WhatsApp (marks a new lead contacted), the next stage, or lost with a reason. */
export async function touchLeadAction(id: string, how: "call" | "whatsapp") {
  const u = await requirePermission("leads.manage");
  await touchLead(u, id, how);
  revalidatePath("/leads");
}

export async function advanceLeadAction(id: string, from: LeadStage) {
  const u = await requirePermission("leads.manage");
  const next = NEXT[from];
  if (next) await setLeadStage(u, id, next).catch((e) => (e instanceof UserError ? null : Promise.reject(e)));
  revalidatePath("/leads");
}

export async function loseLeadAction(id: string, reason: string) {
  const u = await requirePermission("leads.manage");
  return simpleAction(() => setLeadStage(u, id, "Lost", { lostReason: reason }), "Marked lost.").finally(() => revalidatePath("/leads"));
}
