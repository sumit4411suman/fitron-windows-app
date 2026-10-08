"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { stepsFor, validateStep, type StepKey } from "@/lib/domain/onboarding";
import { onboardingForm, onboardingStep } from "@/lib/validation/onboarding";
import { finishOnboarding, saveDraft, skipOnboarding } from "@/lib/services/onboarding";
import { UserError } from "@/lib/services/errors";

/** What the wizard gets back: carry on, or the words to show and the step they belong to. */
export type StepResult = { ok: true } | { ok: false; error: string; step?: StepKey };

const BAD_REQUEST: StepResult = { ok: false, error: "Something went wrong with that page. Reload it and try again." };

/** Continue: checks the step again on the server, then remembers everything typed so far. */
export async function saveStepAction(step: unknown, form: unknown): Promise<StepResult> {
  const u = await requirePermission("settings.manage");
  const key = onboardingStep.safeParse(step);
  const data = onboardingForm.safeParse(form);
  if (!key.success || !data.success || !stepsFor((f) => u.has(f)).includes(key.data)) return BAD_REQUEST;
  const error = validateStep(key.data, data.data);
  if (error) return { ok: false, error, step: key.data };
  try {
    await saveDraft(u, key.data, data.data);
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    throw e;
  }
  return { ok: true };
}

/** Finish setup: every step is checked, then everything is applied. Sends the owner on to the dashboard, or to the import. */
export async function finishAction(form: unknown): Promise<StepResult> {
  const u = await requirePermission("settings.manage");
  const data = onboardingForm.safeParse(form);
  if (!data.success) return BAD_REQUEST;
  const steps = stepsFor((f) => u.has(f));
  let mode: "empty" | "import";
  try {
    ({ mode } = await finishOnboarding(u, data.data, steps));
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, step: onboardingStep.safeParse(e.field).data };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(mode === "import" ? "/settings/import" : "/dashboard?welcome=1");
}

/** "I'll do this later": opens the console; the dashboard keeps a reminder until setup is finished. */
export async function skipAction() {
  const u = await requirePermission("settings.manage");
  await skipOnboarding(u);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
