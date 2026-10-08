"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { formAction } from "@/lib/form-action";
import { guestInput } from "@/lib/validation/frontdesk";
import type { FormState } from "@/lib/validation/common";
import { checkIn, checkInGuest, checkOut, closeDay, deskSearch, findForCheckIn, removeCheckIn, VISIT_TYPES, type CheckInResult, type DeskHit } from "@/lib/services/attendance";
import { UserError } from "@/lib/services/errors";

export type DeskResult = CheckInResult | { ok: false; error: string } | { ok: false; pick: true };

/** Suggestions as the desk types. */
export async function searchAction(q: string): Promise<DeskHit[]> {
  const u = await requirePermission("attendance.manage");
  return deskSearch(u, q);
}

/** Check-in from the desk: by member, or by what was typed when there is exactly one match. */
export async function deskCheckInAction(input: { memberId?: string; q?: string; override?: boolean; method?: string }): Promise<DeskResult> {
  const u = await requirePermission("attendance.manage");
  try {
    let id = input.memberId;
    if (!id) {
      const hits = await findForCheckIn(u, input.q ?? "");
      if (!hits.length) return { ok: false, error: `No member found for “${input.q}”. Try the name, ID or mobile.` };
      if (hits.length > 1) return { ok: false, pick: true };
      id = hits[0]!.id;
    }
    const r = await checkIn(u, id, { method: input.method, override: input.override ? "Allowed by staff" : undefined });
    if (r.ok) revalidatePath("/attendance");
    return r;
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function guestAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("attendance.manage");
  const visit = String(fd.get("visit") ?? "Guest") as keyof typeof VISIT_TYPES;
  let lead = false;
  const r = await formAction(fd, guestInput, async (d) => void ({ lead } = await checkInGuest(u, d.name, d.phone, visit in VISIT_TYPES ? visit : "Guest")), "Logged.");
  if (r?.ok) r.message = lead ? `${fd.get("name")} logged and added to leads.` : `${fd.get("name")} logged.`;
  revalidatePath("/attendance");
  return r;
}

export async function checkOutAction(id: string) {
  const u = await requirePermission("attendance.manage");
  await checkOut(u, id);
  revalidatePath("/attendance");
}

export async function removeAction(id: string) {
  const u = await requirePermission("attendance.manage");
  await removeCheckIn(u, id);
  revalidatePath("/attendance");
}

export async function closeDayAction() {
  const u = await requirePermission("attendance.manage");
  await closeDay(u);
  revalidatePath("/attendance");
}
