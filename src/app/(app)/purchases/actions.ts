"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { formAction } from "@/lib/form-action";
import { purchaseInput, vendorPayInput } from "@/lib/validation/assets";
import { reasonInput } from "@/lib/validation/billing";
import { failed, fieldErrors, type FormState } from "@/lib/validation/common";
import { cancelPurchase, createPurchase, payVendor } from "@/lib/services/purchases";
import { UserError } from "@/lib/services/errors";

const refresh = (id?: string) => {
  for (const p of ["/purchases", "/assets", "/products", "/expenses", "/accounting", "/pos"]) revalidatePath(p);
  if (id) revalidatePath(`/purchases/${id}`);
};

/** The bill form sends its lines as JSON; errors on a line are reported as "Line 2: …". */
export async function createPurchaseAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("purchases.manage");
  let lines: unknown = [];
  try {
    lines = JSON.parse(String(fd.get("lines") ?? "[]"));
  } catch {
    return failed(fd, { message: "The lines couldn't be read. Refresh and try again." });
  }
  const parsed = purchaseInput.safeParse({ ...Object.fromEntries(fd), lines });
  if (!parsed.success) {
    const lineIssue = parsed.error.issues.find((i) => i.path[0] === "lines" && typeof i.path[1] === "number");
    const message = lineIssue ? `Line ${(lineIssue.path[1] as number) + 1}: ${lineIssue.message}` : "Check the highlighted fields.";
    return failed(fd, { errors: fieldErrors(parsed.error), message });
  }
  let id = "";
  try {
    id = (await createPurchase(u, parsed.data)).id;
  } catch (e) {
    if (e instanceof UserError) return failed(fd, { message: e.message, errors: e.field ? { [e.field]: [e.message] } : undefined });
    throw e;
  }
  refresh();
  redirect(`/purchases/${id}`);
}

export async function payVendorAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("purchases.manage");
  const r = await formAction(fd, vendorPayInput, (d) => payVendor(u, id, d), "Payment recorded.");
  refresh(id);
  return r;
}

export async function cancelPurchaseAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("purchases.manage");
  const r = await formAction(fd, reasonInput, (d) => cancelPurchase(u, id, d.reason), "Bill cancelled.");
  refresh(id);
  return r;
}
