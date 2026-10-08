"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { posSaleInput, restockInput } from "@/lib/validation/frontdesk";
import { fieldErrors, type FormState } from "@/lib/validation/common";
import { adjustStock, posSale } from "@/lib/services/pos";
import { resolveMemberRef } from "@/lib/services/members";
import { UserError } from "@/lib/services/errors";

export async function sellAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("pos.sell");
  let items: unknown = [];
  try {
    items = JSON.parse(String(fd.get("items") ?? "[]"));
  } catch {
    return { message: "The bill couldn't be read. Refresh and try again." };
  }
  const who = String(fd.get("member") ?? "").trim();
  let memberId: string | undefined;
  if (who) {
    const m = await resolveMemberRef(u, who);
    if (!m) return { message: "Pick the member from the list, or leave it blank for a walk-in customer.", errors: { member: ["Pick a member from the list."] } };
    memberId = m.id;
  }
  const parsed = posSaleInput.safeParse({ memberId, method: fd.get("method"), txnRef: fd.get("txnRef") ?? "", items });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), message: parsed.error.issues[0]?.message ?? "Check the bill." };
  let id: string;
  try {
    id = (await posSale(u, parsed.data)).id;
  } catch (e) {
    if (e instanceof UserError) return { message: e.message };
    throw e;
  }
  revalidatePath("/pos");
  revalidatePath("/products");
  redirect(`/invoices/${id}?created=1`);
}

/** The Inventory table's Restock dialog: receive stock, optionally booked as an Inventory expense. */
export async function restockAction(productId: string, fd: FormData) {
  const u = await requirePermission("products.manage");
  const parsed = restockInput.safeParse(Object.fromEntries(fd));
  const fail = (m: string) => redirect(`/pos?restock=${productId}&err=${encodeURIComponent(m)}`);
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? "Check the form.");
  const d = parsed.data!;
  if (d.qty <= 0) fail("Enter how many units arrived.");
  try {
    await adjustStock(u, productId, d);
  } catch (e) {
    if (e instanceof UserError) fail(e.message);
    throw e;
  }
  revalidatePath("/pos");
  revalidatePath("/products");
  revalidatePath("/expenses");
  redirect(`/pos?msg=${encodeURIComponent(`Restocked ${d.qty} unit${d.qty === 1 ? "" : "s"}${d.asExpense ? " and recorded the expense" : ""}.`)}#inventory`);
}
