"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import "@/lib/zod-config";
import { requirePermission } from "@/lib/auth/current";
import { changeStaffRole } from "@/lib/services/staff";
import { UserError } from "@/lib/services/errors";

const input = z.object({ userId: z.string().min(1), roleId: z.string().min(1), password: z.string().min(1, { error: "Enter your password." }) });

/** Roles & access: change a role after the caller re-enters their password. */
export async function changeRole(fd: FormData) {
  const u = await requirePermission("staff.manage");
  const userId = String(fd.get("userId") ?? "");
  const roleId = String(fd.get("roleId") ?? "");
  const retry = (error: string) => redirect(`/settings/roles?${new URLSearchParams({ change: userId, role: roleId, error })}`);
  const parsed = input.safeParse(Object.fromEntries(fd));
  if (!parsed.success) retry(parsed.error.issues[0]?.message ?? "Check the form.");
  let done: { name: string; role: string } | null = null;
  try {
    done = await changeStaffRole(u, parsed.data!);
  } catch (e) {
    if (e instanceof UserError) retry(e.message);
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(done ? `/settings/roles?${new URLSearchParams({ saved: "role", name: done.name, role: done.role })}` : "/settings/roles");
}
