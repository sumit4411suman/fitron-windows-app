"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current";
import { readSession } from "@/lib/auth/session";
import { formAction, simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { passwordChangeInput, profileInput, twoStepConfirmInput, twoStepOffInput, twoStepRecoveryInput } from "@/lib/validation/profile";
import { changePassword, removeProfilePhoto, setProfilePhoto, updateProfile } from "@/lib/services/profile";
import { beginTwoStep, cancelTwoStep, confirmTwoStep, disableTwoStep, regenerateRecoveryCodes } from "@/lib/services/two-step";

export async function saveProfile(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  const state = await formAction(fd, profileInput, (d) => updateProfile(u, d), "Profile saved.");
  if (state?.ok) revalidatePath("/", "layout");
  return state;
}

export async function savePassword(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  const session = await readSession();
  return formAction(fd, passwordChangeInput, (d) => changePassword(u, session?.id ?? null, d), "Password changed. Other devices have been signed out.");
}

/** Uploads a new photo, or removes it when the form sends intent=remove. */
export async function changePhoto(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  const state =
    fd.get("intent") === "remove"
      ? await simpleAction(() => removeProfilePhoto(u), "Photo removed.")
      : await simpleAction(() => setProfilePhoto(u, fd.get("photo") as File), "Photo updated.");
  if (state?.ok) revalidatePath("/", "layout");
  return state;
}

// ── Two-step sign-in ──────────────────────────────────────────────────────

/** What the two-step forms answer with: the usual form state, plus recovery codes when new ones were just made (shown once). */
export type TwoStepState = (NonNullable<FormState> & { codes?: string[] }) | undefined;

export async function startTwoStepSetup(): Promise<FormState> {
  const u = await requireUser();
  const state = await simpleAction(() => beginTwoStep(u), "Scan the code with your authenticator app.");
  revalidatePath("/profile");
  return state;
}

export async function cancelTwoStepSetup(): Promise<FormState> {
  const u = await requireUser();
  const state = await simpleAction(() => cancelTwoStep(u), "Setup cancelled.");
  revalidatePath("/profile");
  return state;
}

export async function confirmTwoStepSetup(_: TwoStepState, fd: FormData): Promise<TwoStepState> {
  const u = await requireUser();
  let codes: string[] | undefined;
  const state = await formAction(fd, twoStepConfirmInput, async (d) => void (codes = await confirmTwoStep(u, d.code)), "Two-step sign-in is on.");
  if (state?.ok) revalidatePath("/profile");
  return state && codes ? { ...state, codes } : state;
}

export async function turnOffTwoStep(_: TwoStepState, fd: FormData): Promise<TwoStepState> {
  const u = await requireUser();
  const state = await formAction(fd, twoStepOffInput, (d) => disableTwoStep(u, d), "Two-step sign-in is off.");
  if (state?.ok) revalidatePath("/profile");
  return state;
}

export async function newRecoveryCodes(_: TwoStepState, fd: FormData): Promise<TwoStepState> {
  const u = await requireUser();
  let codes: string[] | undefined;
  const state = await formAction(fd, twoStepRecoveryInput, async (d) => void (codes = await regenerateRecoveryCodes(u, d)), "New recovery codes made. The old ones no longer work.");
  if (state?.ok) revalidatePath("/profile");
  return state && codes ? { ...state, codes } : state;
}
