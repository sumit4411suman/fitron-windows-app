"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { formAction, simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { decisionInput, implementedInput, reviewInput, scenarioMeta, verdictInput } from "@/lib/validation/intelligence";
import { parseInputs } from "@/lib/domain/simulator";
import { createDecision, decide, markImplemented, recordReview, removeOption, saveOption, updateDecision } from "@/lib/services/decisions";

const done = (id?: string) => {
  revalidatePath("/intelligence/decisions");
  if (id) revalidatePath(`/intelligence/decisions/${id}`);
};

export async function createDecisionAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  let id: string | null = null;
  const r = await formAction(fd, decisionInput, async (d) => {
    id = (await createDecision(u, d)).id;
  }, "Decision created.");
  done();
  if (id) redirect(`/intelligence/decisions/${id}`);
  return r;
}

export async function updateDecisionAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  const r = await formAction(fd, decisionInput, (d) => updateDecision(u, id, d, "Edited the decision"), "Saved as a new revision.");
  done(id);
  return r;
}

export async function saveOptionAction(decisionId: string, optionId: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  const r = await formAction(fd, scenarioMeta, async (d) => {
    let inputs;
    try {
      inputs = parseInputs(JSON.parse(String(fd.get("inputs") ?? "{}")));
    } catch {
      inputs = parseInputs(null);
    }
    const scores: Record<string, number> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("score.") && String(v)) scores[k.slice(6)] = Number(v);
    await saveOption(u, decisionId, { name: d.name, description: d.note, inputs, scores, benefits: String(fd.get("benefits") ?? ""), costs: String(fd.get("costs") ?? ""), risks: String(fd.get("risks") ?? "") }, optionId ?? undefined);
  }, "Option saved.");
  done(decisionId);
  return r;
}

export async function removeOptionAction(decisionId: string, optionId: string): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  const r = await simpleAction(() => removeOption(u, decisionId, optionId), "Option removed.");
  done(decisionId);
  return r;
}

export async function verdictAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("settings.manage");
  const r = await formAction(fd, verdictInput, (d) => decide(u, id, d.verdict, { optionId: d.optionId, rationale: d.rationale, deferredUntil: d.deferredUntil }), "Recorded.");
  done(id);
  return r;
}

export async function implementAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("settings.manage");
  const r = await formAction(fd, implementedInput, (d) => markImplemented(u, id, d.implementedOn), "Implementation recorded.");
  done(id);
  return r;
}

export async function reviewAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("settings.manage");
  const r = await formAction(fd, reviewInput, (d) => recordReview(u, id, d.lessons ?? ""), "Review recorded.");
  done(id);
  return r;
}
