"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { setBenchmarkConsent } from "@/lib/services/benchmark";

export async function consentAction(optIn: boolean): Promise<FormState> {
  const u = await requirePermission("settings.manage");
  const r = await simpleAction(() => setBenchmarkConsent(u, optIn), optIn ? "Benchmarking switched on: this gym's aggregated monthly figures join the pool from tonight's job." : "Benchmarking switched off and this gym's figures removed from the pool.");
  revalidatePath("/intelligence/benchmarking");
  return r;
}
