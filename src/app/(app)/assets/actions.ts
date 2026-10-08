"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { formAction, simpleAction } from "@/lib/form-action";
import { assetInput, disposeInput } from "@/lib/validation/assets";
import { reasonInput } from "@/lib/validation/billing";
import type { FormState } from "@/lib/validation/common";
import { createAsset, disposeAsset, removeAsset, undoDisposal, updateAsset } from "@/lib/services/assets";

const refresh = (id?: string) => {
  revalidatePath("/assets");
  if (id) revalidatePath(`/assets/${id}`);
  revalidatePath("/accounting");
  revalidatePath("/expenses");
};

export async function saveAssetAction(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("assets.manage");
  let newId = id;
  const r = await formAction(fd, assetInput, async (d) => {
    newId = (id ? await updateAsset(u, id, d) : await createAsset(u, d)).id;
  }, "Asset saved.");
  if (!r?.ok) return r;
  refresh(newId ?? undefined);
  redirect(`/assets/${newId}`);
}

export async function disposeAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("assets.manage");
  const r = await formAction(fd, disposeInput, (d) => disposeAsset(u, id, d), "Disposal recorded.");
  refresh(id);
  return r;
}

export async function undoDisposalAction(id: string): Promise<FormState> {
  const u = await requirePermission("assets.manage");
  const r = await simpleAction(() => undoDisposal(u, id), "Back in use.");
  refresh(id);
  return r;
}

export async function removeAssetAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("assets.manage");
  const r = await formAction(fd, reasonInput, (d) => removeAsset(u, id, d.reason), "Asset removed.");
  if (!r?.ok) return r;
  refresh();
  redirect("/assets");
}
