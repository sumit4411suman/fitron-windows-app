"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { createBackup, restoreBackup, type RestoreSource } from "@/lib/services/backup";
import { UserError } from "@/lib/services/errors";
import { fmtStamp } from "@/lib/format";
import { localBackupNow, localRestore } from "@/lib/services/local-backup";
import { backupPath } from "@/lib/runtime/fitron-backup";
import { writeLocalSettings } from "@/lib/runtime/local-settings";

const q = (params: Record<string, string>) => `/settings/backup?${new URLSearchParams(params)}`;

/** Back up now: the whole gym to a file in private storage. Open to a gym whose plan lapsed, so it can take its data. */
export async function backupNow() {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  let id: string;
  try {
    id = (await createBackup(u, "MANUAL")).id;
  } catch (e) {
    if (e instanceof UserError) redirect(q({ error: e.message }));
    throw e;
  }
  revalidatePath("/settings/backup");
  redirect(q({ saved: id }));
}

async function restore(source: RestoreSource, fd: FormData, key: string) {
  const u = await requirePermission("settings.manage");
  let stamp: string;
  try {
    const r = await restoreBackup(u, source, String(fd.get("confirm") ?? ""));
    stamp = fmtStamp(r.exportedAt);
  } catch (e) {
    if (e instanceof UserError) redirect(q({ restore: key, error: e.message }));
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(q({ restored: stamp }));
}

/** Restore one of the backups on the server (Super Admin, typed RESTORE). */
export async function restoreFromServer(id: string, fd: FormData) {
  await restore({ backupId: id }, fd, id);
}

/** Restore an uploaded backup file (Super Admin, typed RESTORE). */
export async function restoreFromFile(fd: FormData) {
  await restore({ file: fd.get("file") as File }, fd, "file");
}

// ── Local Edition (FITRON on a computer) ───────────────────────────────────────────────────────────────────────────


/** Backup now (Local): the whole installation to a .fitronbackup, with an optional password. */
export async function localBackupNowAction(fd: FormData) {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("password2") ?? "")) redirect(q({ error: "The two backup passwords are not the same." }));
  let name: string;
  try {
    name = (await localBackupNow(u, { password })).name;
  } catch (e) {
    if (e instanceof UserError) redirect(q({ error: e.message }));
    throw e;
  }
  revalidatePath("/settings/backup");
  redirect(q({ saved: name }));
}

/** Restore one of the backups in the backups folder (Local, Super Admin, typed RESTORE). */
export async function restoreLocalFromList(kind: string, name: string, fd: FormData) {
  const u = await requirePermission("settings.manage");
  const file = backupPath(kind, name);
  if (!file) redirect(q({ error: "That backup is no longer in the backups folder." }));
  let at: string;
  try {
    at = (await localRestore(u, { file, password: String(fd.get("password") ?? ""), confirm: String(fd.get("confirm") ?? ""), label: name })).manifest.createdAt;
  } catch (e) {
    if (e instanceof UserError) redirect(q({ restore: `${kind}/${name}`, error: e.message }));
    throw e;
  }
  redirect(`/login?${new URLSearchParams({ restored: at })}`);
}

/** Automatic backup on or off, and how many to keep (Local). */
export async function saveLocalBackupSettings(fd: FormData) {
  const u = await requirePermission("settings.manage");
  if (u.role !== "Super Admin") redirect(q({ error: "Only a Super Admin can change backup settings." }));
  writeLocalSettings({ autoBackup: fd.get("autoBackup") === "on", keepAutoBackups: Number(fd.get("keepAutoBackups")) || 14 });
  revalidatePath("/settings/backup");
  redirect(q({ settings: "1" }));
}
