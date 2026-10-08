"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { formAction, simpleAction } from "@/lib/form-action";
import { classInput } from "@/lib/validation/frontdesk";
import type { FormState } from "@/lib/validation/common";
import { book, bookedMembers, getSlot, markAllAttended, saveSlot, setBookingStatus, setSlotActive } from "@/lib/services/classes";
import { db } from "@/lib/db";
import { sendLater, sendTemplate } from "@/lib/services/whatsapp";
import { fmtClock, fmtDate } from "@/lib/format";
import { resolveMemberRef } from "@/lib/services/members";
import { UserError } from "@/lib/services/errors";

export async function saveClass(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("classes.manage");
  let newId = id;
  const r = await formAction(fd, classInput, async (d) => {
    newId = (await saveSlot(u, id, d)).id;
  }, "Class saved.");
  if (!r?.ok) return r;
  revalidatePath("/classes");
  redirect(`/classes/${newId}`);
}

export async function toggleClass(id: string, active: boolean) {
  const u = await requirePermission("classes.manage");
  await setSlotActive(u, id, active);
  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
}

export async function bookAction(slotId: string, date: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("classes.manage");
  const r = await simpleAction(async () => {
    const m = await resolveMemberRef(u, String(fd.get("member") ?? ""));
    if (!m) throw new UserError("Pick a member from the list.");
    const b = await book(u, slotId, date, m.id);
    if (b.status === "Booked") {
      const slot = await getSlot(u, slotId);
      sendLater({ orgId: u.orgId, memberId: m.id, key: "class", userId: u.id, vars: { class_name: slot?.name ?? "", class_time: `${fmtDate(date)}, ${fmtClock(slot?.startTime ?? "00:00")}` } });
    }
    if (b.status === "Waitlist") throw new UserError(`The class is full, so ${m.name} is on the waitlist.`);
  }, "Booked.");
  revalidatePath(`/classes/${slotId}`);
  revalidatePath("/classes");
  return r;
}

export async function bookingStatusAction(id: string, slotId: string, status: "Cancelled" | "Attended" | "No-show" | "Booked") {
  const u = await requirePermission("classes.manage");
  const r = await setBookingStatus(u, id, status);
  // The member moved in off the waitlist hears about it on WhatsApp (prototype).
  if (r.promotedId) {
    const b = await db.booking.findUniqueOrThrow({ where: { id }, include: { classSlot: true } });
    const date = b.date.toISOString().slice(0, 10);
    sendLater({ orgId: u.orgId, memberId: r.promotedId, key: "class", userId: u.id, vars: { class_name: b.classSlot.name, class_time: `${fmtDate(date)}, ${fmtClock(b.classSlot.startTime)}` } });
  }
  revalidatePath(`/classes/${slotId}`);
  revalidatePath("/classes");
}

export async function markAllAttendedAction(slotId: string, date: string, back: string) {
  const u = await requirePermission("classes.manage");
  const n = await markAllAttended(u, slotId, date).catch((e) => (e instanceof UserError ? 0 : Promise.reject(e)));
  revalidatePath("/classes");
  redirect(`${back}&msg=${encodeURIComponent(`${n} marked attended.`)}`);
}

export async function remindClassAction(slotId: string, date: string, back: string) {
  const u = await requirePermission("whatsapp.send");
  const slot = await getSlot(u, slotId);
  if (!slot) redirect(back);
  const trainer = await db.user.findUnique({ where: { id: slot.trainerId }, select: { name: true } });
  const ids = await bookedMembers(u, slotId, date);
  const body = `Hi {{member_name}}, reminder: ${slot.name}${trainer ? ` with ${trainer.name}` : ""} is on ${fmtDate(date)} at ${fmtClock(slot.startTime)}. See you there!`;
  for (const memberId of ids) await sendTemplate({ orgId: u.orgId, memberId, key: "campaign", body, userId: u.id, force: true });
  redirect(`${back}&msg=${encodeURIComponent(`Reminder sent to ${ids.length} member${ids.length === 1 ? "" : "s"}.`)}`);
}

