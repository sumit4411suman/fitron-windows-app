"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { formAction, simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { scenarioMeta } from "@/lib/validation/intelligence";
import { parseInputs } from "@/lib/domain/simulator";
import { archiveScenario, createScenario, duplicateScenario, updateScenario } from "@/lib/services/simulator";

function inputsFrom(fd: FormData) {
  try {
    return parseInputs(JSON.parse(String(fd.get("inputs") ?? "{}")));
  } catch {
    return parseInputs(null);
  }
}

export async function saveScenarioAction(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  let newId: string | null = null;
  const r = await formAction(fd, scenarioMeta, async (d) => {
    const inputs = inputsFrom(fd);
    if (id) await updateScenario(u, id, { name: d.name, note: d.note ?? "", inputs });
    else newId = (await createScenario(u, { name: d.name, note: d.note, inputs })).id;
  }, "Scenario saved.");
  revalidatePath("/intelligence/simulator");
  if (newId) redirect(`/intelligence/simulator/${newId}`);
  return r;
}

export async function duplicateScenarioAction(id: string): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  let copy: string | null = null;
  const r = await simpleAction(async () => {
    copy = (await duplicateScenario(u, id)).id;
  }, "Copied.");
  revalidatePath("/intelligence/simulator");
  if (copy) redirect(`/intelligence/simulator/${copy}`);
  return r;
}

export async function archiveScenarioAction(id: string, archived: boolean): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  const r = await simpleAction(() => archiveScenario(u, id, archived), archived ? "Scenario archived." : "Scenario restored.");
  revalidatePath("/intelligence/simulator");
  revalidatePath(`/intelligence/simulator/${id}`);
  return r;
}
