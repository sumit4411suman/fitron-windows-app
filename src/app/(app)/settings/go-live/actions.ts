"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import "@/lib/zod-config";
import { requirePermission } from "@/lib/auth/current";
import { putSetting } from "@/lib/services/settings";
import { clearDemoData } from "@/lib/services/go-live";
import { UserError } from "@/lib/services/errors";

const back = (params: Record<string, string>) => redirect(`/settings/go-live?${new URLSearchParams(params)}`);

const securityInput = z.object({ idleMinutes: z.coerce.number().int({ error: "Whole minutes only." }).min(0, { error: "0 or more minutes." }).max(1440, { error: "At most 1440 minutes (a day)." }) });

/** Settings › Go live › Security: idle sign-out minutes (Setting `security`, audited). */
export async function saveSecurity(fd: FormData) {
  const u = await requirePermission("settings.manage");
  const parsed = securityInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) back({ error: parsed.error.issues[0]?.message ?? "Check the form." });
  await putSetting(u, "security", parsed.data!);
  revalidatePath("/", "layout");
  back({ saved: "security" });
}

const CLEAR_CONFIRM = "CLEAR DEMO DATA";

/** Go live: removes the seeded demo gym's records after a typed confirmation. */
export async function clearDemo(fd: FormData) {
  const u = await requirePermission("settings.manage");
  if (String(fd.get("confirm") ?? "").trim() !== CLEAR_CONFIRM) back({ clear: "1", error: `Type ${CLEAR_CONFIRM} exactly to confirm.` });
  try {
    await clearDemoData(u);
  } catch (e) {
    if (e instanceof UserError) back({ clear: "1", error: e.message });
    throw e;
  }
  revalidatePath("/", "layout");
  redirect("/dashboard?cleared=1");
}
