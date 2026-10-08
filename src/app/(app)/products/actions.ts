"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { formAction } from "@/lib/form-action";
import { productInput, restockInput } from "@/lib/validation/frontdesk";
import type { FormState } from "@/lib/validation/common";
import { adjustStock, saveProduct, setProductActive } from "@/lib/services/pos";

export async function saveProductAction(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("products.manage");
  let newId = id;
  const r = await formAction(fd, productInput, async (d) => {
    newId = (await saveProduct(u, id, d)).id;
  }, "Product saved.");
  if (!r?.ok) return r;
  revalidatePath("/products");
  revalidatePath("/pos");
  if (!id) redirect(`/products/${newId}`);
  return r;
}

export async function stockAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("products.manage");
  const r = await formAction(fd, restockInput, (d) => adjustStock(u, id, d), "Stock updated.");
  revalidatePath(`/products/${id}`);
  revalidatePath("/products");
  revalidatePath("/pos");
  return r;
}

export async function toggleProduct(id: string, active: boolean) {
  const u = await requirePermission("products.manage");
  await setProductActive(u, id, active);
  revalidatePath(`/products/${id}`);
  revalidatePath("/products");
  revalidatePath("/pos");
}
