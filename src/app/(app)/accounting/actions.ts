"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { lockMonth, unlockMonth } from "@/lib/services/accounting";
import { UserError } from "@/lib/services/errors";
import { monthLabel } from "@/lib/domain/periods";

const back = (month: string, key: "msg" | "error", text: string) => redirect(`/accounting?tab=close&m=${month}&${key}=${encodeURIComponent(text)}`);

export async function lock(month: string): Promise<void> {
  const u = await requirePermission("months.lock");
  try {
    await lockMonth(u, month);
  } catch (e) {
    if (e instanceof UserError) back(month, "error", e.message);
    throw e;
  }
  revalidatePath("/accounting");
  back(month, "msg", `${monthLabel(month)} is locked.`);
}

export async function unlock(month: string): Promise<void> {
  const u = await requirePermission("months.unlock");
  try {
    await unlockMonth(u, month);
  } catch (e) {
    if (e instanceof UserError) back(month, "error", e.message);
    throw e;
  }
  revalidatePath("/accounting");
  back(month, "msg", `${monthLabel(month)} is unlocked.`);
}
