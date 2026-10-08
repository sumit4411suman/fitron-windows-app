"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { formAction, simpleAction } from "@/lib/form-action";
import { progressInput, recordInput } from "@/lib/validation/frontdesk";
import type { FormState } from "@/lib/validation/common";
import { addProgress, addRecord, assignPrograms, getDiet, getWorkout, removeRecord } from "@/lib/services/programs";
import { getMember } from "@/lib/services/members";
import { sendTemplate } from "@/lib/services/whatsapp";
import { planMessage } from "@/lib/domain/programs";
import { UserError } from "@/lib/services/errors";

export async function assignAction(memberId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("members.view");
  if (!(u.can("programs.manage") || u.can("members.edit"))) return { message: "Your role can't change programs." };
  if (!u.has("programs")) return { message: "Workouts & diet are on the Professional plan. A Super Admin can upgrade in Settings › Plan & billing." };
  const r = await simpleAction(
    () => assignPrograms(u, memberId, { trainerId: (fd.get("trainerId") as string) || null, workoutPlanId: (fd.get("workoutPlanId") as string) || null, dietPlanId: (fd.get("dietPlanId") as string) || null }),
    "Program updated.",
  );
  revalidatePath(`/members/${memberId}`);
  return r;
}

const back = (id: string, p: Record<string, string>): never => redirect(`/members/${id}?${new URLSearchParams({ tab: "fitness", ...p })}`);

export async function sendPlanAction(memberId: string) {
  const u = await requirePermission("whatsapp.send");
  const m = await getMember(u, memberId);
  if (!m) return back(memberId, { msg: "Member not found." });
  const [workout, diet] = await Promise.all([m.workoutPlanId ? getWorkout(u, m.workoutPlanId) : null, m.dietPlanId ? getDiet(u, m.dietPlanId) : null]);
  if (!workout && !diet) return back(memberId, { msg: "Assign a workout or diet plan first." });
  const sent = await sendTemplate({ orgId: u.orgId, memberId, key: "campaign", userId: u.id, force: true, body: planMessage({ workout, dietName: diet?.name ?? null }) });
  revalidatePath(`/members/${memberId}`);
  back(memberId, { msg: !sent ? "Plan could not be sent." : sent.status === "Failed" ? `Plan could not be sent: ${sent.error}` : "Plan sent on WhatsApp." });
}

export async function measureAction(memberId: string, fd: FormData) {
  const u = await requirePermission("programs.manage");
  const parsed = progressInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return back(memberId, { do: "measure", err: parsed.error.issues[0]?.message ?? "Check the fields." });
  try {
    await addProgress(u, memberId, parsed.data);
  } catch (e) {
    if (e instanceof UserError) return back(memberId, { do: "measure", err: e.message });
    throw e;
  }
  revalidatePath(`/members/${memberId}`);
  back(memberId, { msg: "Measurement saved." });
}

export async function recordAction(memberId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("programs.manage");
  const r = await formAction(fd, recordInput, (d) => addRecord(u, memberId, d), "Record saved.");
  revalidatePath(`/members/${memberId}`);
  return r;
}

export async function removeRecordAction(memberId: string, id: string) {
  const u = await requirePermission("programs.manage");
  try {
    await removeRecord(u, memberId, id);
  } catch (e) {
    if (e instanceof UserError) return back(memberId, { msg: e.message });
    throw e;
  }
  revalidatePath(`/members/${memberId}`);
  back(memberId, { msg: "Record removed." });
}
