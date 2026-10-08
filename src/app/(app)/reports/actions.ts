"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { REPORTS, favKey } from "@/lib/services/reports";

export async function toggleFavourite(key: string) {
  const u = await requireUser();
  if (!REPORTS[key]) return;
  const k = favKey(u.id);
  const row = await db.setting.findUnique({ where: { orgId_key: { orgId: u.orgId, key: k } } });
  const now = Array.isArray(row?.value) ? (row.value as string[]) : [];
  const value = now.includes(key) ? now.filter((x) => x !== key) : [...now, key];
  await db.setting.upsert({ where: { orgId_key: { orgId: u.orgId, key: k } }, create: { orgId: u.orgId, key: k, value }, update: { value } });
  revalidatePath("/reports");
}
