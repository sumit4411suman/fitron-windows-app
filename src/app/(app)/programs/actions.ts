"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { formAction } from "@/lib/form-action";
import { dietInput, workoutInput } from "@/lib/validation/frontdesk";
import type { FormState } from "@/lib/validation/common";
import { saveDiet, saveWorkout, setProgramActive } from "@/lib/services/programs";

export async function saveWorkoutAction(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("programs.manage");
  const r = await formAction(fd, workoutInput, (d) => saveWorkout(u, id, d), "Workout saved.");
  if (!r?.ok) return r;
  revalidatePath("/programs");
  redirect("/programs");
}

export async function saveDietAction(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("programs.manage");
  const r = await formAction(fd, dietInput, (d) => saveDiet(u, id, d), "Diet saved.");
  if (!r?.ok) return r;
  revalidatePath("/programs");
  redirect("/programs?tab=diets");
}

export async function toggleProgram(kind: "workout" | "diet", id: string, active: boolean) {
  const u = await requirePermission("programs.manage");
  await setProgramActive(u, kind, id, active);
  revalidatePath("/programs");
}
