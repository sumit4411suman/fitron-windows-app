"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import "@/lib/zod-config";
import { requireFeature, requirePermission } from "@/lib/auth/current";
import { assignCard, enrol, eraseBiometrics, openDoor, removeDevice, saveDevice, syncDevice, testScan } from "@/lib/services/biometric";
import { db } from "@/lib/db";
import { UserError } from "@/lib/services/errors";
import { accessInput } from "@/lib/validation/frontdesk";
import { putSetting } from "@/lib/services/settings";

const back = (params: Record<string, string>): never => redirect(`/settings/devices?${new URLSearchParams(params)}`);

const deviceInput = z.object({
  serial: z.string().trim().regex(/^[A-Za-z0-9_-]{4,40}$/, "Type the serial number from the device's label or its System info screen."),
  name: z.string().trim().min(1, "Give it a name, like Main door").max(40),
  branchId: z.string().min(1, "Pick a branch"),
  relaySeconds: z.coerce.number().int().min(1).max(60),
});

async function run(fn: () => Promise<unknown>, okText: string | (() => string), params: Record<string, string> = {}) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof UserError) back({ ...params, error: e.message });
    throw e;
  }
  revalidatePath("/settings/devices");
  back({ saved: typeof okText === "function" ? okText() : okText });
}

export async function saveDeviceAction(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await requireFeature("biometric");
  const p = deviceInput.safeParse(Object.fromEntries(fd));
  if (!p.success) back({ error: p.error.issues[0]?.message ?? "Check the form." });
  else await run(() => saveDevice(u, p.data), "Device saved. It picks up its members on its next call in.");
}

export async function removeDeviceAction(id: string) {
  const u = await requirePermission("settings.manage");
  await requireFeature("biometric");
  await run(() => removeDevice(u, id), "Device removed.");
}

export async function syncDeviceAction(id: string) {
  const u = await requirePermission("settings.manage");
  await requireFeature("biometric");
  let msg = "";
  await run(async () => {
    const r = await syncDevice(u, id);
    msg = r.members === 0 ? "No enrolled members to send yet." : `Members and rules queued for ${r.device}: ${r.commands} commands. The device applies them on its next call in.`;
  }, () => msg);
}

export async function openDoorAction(id: string) {
  const u = await requirePermission("attendance.manage");
  await requireFeature("biometric");
  await run(() => openDoor(u, id), "Door will open on the device's next call in (within a few seconds).");
}

/** The door rules, edited on this page (the same setting as Settings → Entry rules). */
export async function saveRulesAction(fd: FormData) {
  const u = await requirePermission("settings.manage");
  await requireFeature("biometric");
  const p = accessInput.safeParse(Object.fromEntries(fd));
  if (!p.success) back({ error: p.error.issues[0]?.message ?? "Check the rules." });
  else await run(() => putSetting(u, "access", p.data), "Door rules saved. Devices pick them up on their next sync.");
}

const q = (fd: FormData) => String(fd.get("q") ?? "");

export async function enrolAction(fd: FormData) {
  const u = await requirePermission("members.edit");
  await requireFeature("biometric");
  const memberId = String(fd.get("memberId") ?? "");
  const kind = fd.get("kind") === "FACE" ? "FACE" : "FP";
  const deviceId = String(fd.get("deviceId") ?? "");
  const keep = { enrol: memberId, kind, ...(q(fd) ? { q: q(fd) } : {}) };
  let device = "";
  await run(async () => {
    await enrol(u, memberId, deviceId, kind, fd.get("consent") === "on");
    device = (await db.device.findUnique({ where: { id: deviceId }, select: { name: true, serial: true } }))?.name ?? "the device";
  }, () => `Sent to ${device}. ${kind === "FACE" ? "Ask the member to look at the camera." : "Ask the member to place a finger three times."}`, keep);
}

export async function assignCardAction(fd: FormData) {
  const u = await requirePermission("members.edit");
  await requireFeature("biometric");
  const memberId = String(fd.get("memberId") ?? "");
  const card = String(fd.get("card") ?? "");
  await run(() => assignCard(u, memberId, card), card.trim() ? "Card saved. It reaches the devices on their next call in." : "Card removed.", { card: memberId, ...(q(fd) ? { q: q(fd) } : {}) });
}

export async function testScanAction(memberId: string) {
  const u = await requirePermission("attendance.manage");
  await requireFeature("biometric");
  let r: Awaited<ReturnType<typeof testScan>>;
  try {
    r = await testScan(u, memberId);
  } catch (e) {
    if (e instanceof UserError) return back({ error: e.message });
    throw e;
  }
  revalidatePath("/settings/devices");
  back(r.allowed ? { saved: `${r.name}: access granted · door would open` } : { error: `${r.name}: access denied · ${r.reason}` });
}

export async function eraseAction(memberId: string) {
  const u = await requirePermission("members.edit");
  await requireFeature("biometric");
  await run(() => eraseBiometrics(u, memberId), "Biometric data deleted here and removed from every device.");
}
