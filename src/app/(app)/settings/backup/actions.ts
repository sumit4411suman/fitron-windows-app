"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { createBackup, restoreBackup, type RestoreSource } from "@/lib/services/backup";
import { UserError } from "@/lib/services/errors";
import { fmtStamp } from "@/lib/format";

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
