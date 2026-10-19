"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { formAction, simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { recommendationDecision } from "@/lib/validation/intelligence";
import { decideRecommendation, refreshRecommendations } from "@/lib/services/growth";

export async function refreshGrowth(): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  const r = await simpleAction(() => refreshRecommendations(u), "Recommendations refreshed.");
  revalidatePath("/intelligence");
  return r;
}

export async function decideRec(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("accounting.view");
  const r = await formAction(fd, recommendationDecision, (d) => decideRecommendation(u, id, d.status, { note: d.note, deferredUntil: d.deferredUntil }), "Recorded.");
  revalidatePath("/intelligence");
  return r;
}
