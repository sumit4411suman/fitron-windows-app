"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { BRANCH_COOKIE, requireUser } from "@/lib/auth/current";

export async function switchBranch(formData: FormData) {
  const u = await requireUser();
  const b = String(formData.get("branch") ?? "");
  if (b !== "ALL" && !u.branches.some((x) => x.id === b && x.active)) return;
  (await cookies()).set(BRANCH_COOKIE, b, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
