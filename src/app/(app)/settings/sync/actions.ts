"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { UserError } from "@/lib/services/errors";
import { holdRecoveryKey } from "@/lib/services/local-setup";
import { isLocal } from "@/lib/runtime/edition";
import { reopenLocalConnections } from "@/lib/runtime/sqlite-adapter";
import { SyncHttpError } from "@/lib/integrations/sync";
import { dismissFailed, retryFailed } from "@/lib/sync/client";
import { linkFromCloud, linkToCloud, unlinkComputer } from "@/lib/sync/link";
import { writeRecord } from "@/lib/sync/records";
import { revokeDevice } from "@/lib/sync/server";
import { syncNow, syncSoon } from "@/lib/sync/worker";
import type { WireRow } from "@/lib/sync/codec";

const back = (p: Record<string, string>): never => redirect(`/settings/sync?${new URLSearchParams(p)}`);
const words = (e: unknown) => (e instanceof UserError || e instanceof SyncHttpError ? e.message : null);

async function owner() {
  const u = await requirePermission("settings.manage");
  const me = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { role: true } });
  if (me.role.name !== "Super Admin") back({ error: "Only a Super Admin can change cloud sync." });
  return u;
}

/** Use the gym that is on fitron.in: it replaces what is on this computer (after a safety backup). */
export async function linkFromCloudAction(fd: FormData) {
  const u = await owner();
  if (!isLocal()) back({ error: "Cloud sync is set up on the computer." });
  let r;
  try {
    r = await linkFromCloud(u, { email: String(fd.get("email") ?? ""), password: String(fd.get("password") ?? ""), code: String(fd.get("code") ?? "") || undefined, confirm: String(fd.get("confirm") ?? "") });
  } catch (e) {
    const m = words(e);
    if (!m) throw e;
    back({ error: m, tab: "from" });
  }
  await reopenLocalConnections();
  // Everyone was signed out (a new database): the owner signs in with their fitron.in password and sees a new recovery key.
  holdRecoveryKey(r!.userId, r!.recoveryKey);
  redirect(`/login?${new URLSearchParams({ linked: r!.gym, next: "/settings/sync?linked=1" })}`);
}

/** Put this gym on fitron.in: a new fitron.in account with this computer's records. */
export async function linkToCloudAction(fd: FormData) {
  const u = await owner();
  if (!isLocal()) back({ error: "Cloud sync is set up on the computer." });
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) back({ error: "The two passwords are not the same.", tab: "to" });
  let r;
  try {
    r = await linkToCloud(u, { email: String(fd.get("email") ?? ""), password });
  } catch (e) {
    const m = words(e);
    if (!m) throw e;
    back({ error: m, tab: "to" });
  }
  syncSoon();
  back({ ok: `${r!.gym} is on fitron.in now. ${r!.queued} records are going up; this page shows how far it has got.` });
}

export async function syncNowAction() {
  await owner();
  try {
    const r = await syncNow();
    revalidatePath("/", "layout");
    back({ ok: r ? `Synced: ${r.pushed} records up, ${r.pulled} down${r.resynced ? ", the whole gym downloaded again" : ""}.` : "This computer is not linked." });
  } catch (e) {
    const m = words(e);
    if (!m) throw e;
    back({ error: m });
  }
}

export async function retryFailedAction(fd: FormData) {
  await owner();
  const seq = fd.get("seq");
  const n = await retryFailed(seq ? [BigInt(String(seq))] : undefined);
  syncSoon();
  back({ ok: `${n} ${n === 1 ? "change goes" : "changes go"} up again.` });
}

export async function dismissFailedAction(fd: FormData) {
  await owner();
  const seq = fd.get("seq");
  await dismissFailed(seq ? [BigInt(String(seq))] : undefined);
  back({ ok: "Kept on this computer only." });
}

/**
 * Settles a conflict. "theirs" / "ours" write that version as an ordinary change here, which then goes up (from the
 * version fitron.in has now), so both sides end up with the chosen one; "dismiss" leaves the records as they are.
 */
export async function resolveConflictAction(fd: FormData) {
  const u = await owner();
  const id = String(fd.get("id") ?? "");
  const keep = String(fd.get("keep") ?? "dismiss");
  const c = await db.syncConflict.findFirst({ where: { id, resolvedAt: null } });
  if (!c) back({ error: "That conflict is settled already." });
  try {
    await db.$transaction(async (tx) => {
      const pick = keep === "ours" ? c!.ours : keep === "theirs" ? c!.theirs : undefined;
      if (keep !== "dismiss") await writeRecord(tx, c!.entity, c!.entityId, (pick ?? null) as WireRow | null);
      await tx.syncConflict.update({ where: { id: c!.id }, data: { resolvedAt: new Date(), resolvedById: u.id, resolution: keep } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "sync.conflict_settled", entity: c!.entity, entityId: c!.entityId, after: { keep, kind: c!.kind } });
    });
  } catch (e) {
    const m = words(e) ?? (e instanceof Error && /financial records are kept/.test(e.message) ? e.message : null);
    if (!m) throw e;
    back({ error: m });
  }
  syncSoon();
  back({ ok: keep === "dismiss" ? "Conflict dismissed." : "Done. The chosen version goes to the other side." });
}

export async function unlinkComputerAction() {
  const u = await owner();
  await unlinkComputer(u);
  back({ ok: "This computer is no longer linked. Its records stay here; changes are no longer sent." });
}

/** On fitron.in: stop a linked computer. */
export async function revokeDeviceAction(fd: FormData) {
  const u = await owner();
  try {
    await revokeDevice(u.orgId, u.id, String(fd.get("id") ?? ""));
  } catch (e) {
    const m = words(e);
    if (!m) throw e;
    back({ error: m });
  }
  back({ ok: "That computer is unlinked. It stops syncing at its next try." });
}
