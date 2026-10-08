"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { expenseInput } from "@/lib/validation/expense";
import { reasonInput } from "@/lib/validation/billing";
import { failed, fieldErrors, type FormState } from "@/lib/validation/common";
import { createExpense, voidExpense } from "@/lib/services/expenses";
import { UserError } from "@/lib/services/errors";

export async function addExpense(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("expenses.manage");
  const parsed = expenseInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  try {
    await createExpense(u, parsed.data);
  } catch (e) {
    if (e instanceof UserError) return failed(fd, { message: e.message, errors: e.field ? { [e.field]: [e.message] } : undefined });
    throw e;
  }
  revalidatePath("/expenses");
  return { ok: true, message: "Expense recorded.", nonce: Math.random().toString(36) };
}

export async function voidIt(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("expenses.void");
  const parsed = reasonInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  try {
    await voidExpense(u, id, parsed.data.reason);
  } catch (e) {
    if (e instanceof UserError) return { message: e.message };
    throw e;
  }
  revalidatePath("/expenses");
  return { ok: true, message: "Expense voided." };
}
