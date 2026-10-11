import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { isLocal } from "@/lib/runtime/edition";
import { BackupError, createLocalBackup, listLocalBackups, pruneLocalBackups, restoreLocalBackup, type CreatedBackup, type LocalBackupKind } from "@/lib/runtime/fitron-backup";
import { migrationsDir } from "@/lib/runtime/local-migrate";
import { readLocalSettings } from "@/lib/runtime/local-settings";
import { dataDirs } from "@/lib/runtime/paths";
import { reopenLocalConnections } from "@/lib/runtime/sqlite-adapter";
import { audit } from "./audit";
import { UserError } from "./errors";

// Settings › Backup on the Local Edition (src/lib/runtime/fitron-backup.ts does the work). A backup is the whole
// installation, so taking, downloading and restoring one is for a Super Admin. Restoring replaces every gym on the
// computer, so it is refused while more than one gym is on it.

const appVersion = () => process.env.APP_VERSION ?? "0.0.0";

function onlyLocal() {
  if (!isLocal()) throw new UserError("This backup is for FITRON on a computer.");
}

function superAdmin(u: CurrentUser) {
  if (u.role !== "Super Admin") throw new UserError("Only a Super Admin can do this: a backup holds every record and login on this computer.");
}

export async function localBackupNow(u: CurrentUser, opts: { password?: string; kind?: LocalBackupKind } = {}): Promise<CreatedBackup> {
  onlyLocal();
  superAdmin(u);
  const password = opts.password?.trim() || undefined;
  if (password && password.length < 8) throw new UserError("Use a backup password of at least 8 characters, or leave it empty.", "password");
  const kind = opts.kind ?? "manual";
  let b: CreatedBackup;
  try {
    b = await createLocalBackup({ dirs: dataDirs(), kind, password, appVersion: appVersion() });
  } catch (e) {
    if (e instanceof BackupError) throw new UserError(e.message);
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOSPC") throw new UserError("The disk is full, so the backup could not be written. Free some space and try again.");
    throw e;
  }
  if (kind === "safety") await pruneLocalBackups("safety", readLocalSettings().keepSafetyBackups);
  await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: `backup.local.${kind}`, entity: "Backup", entityId: b.name, after: { size: b.size, sha256: b.sha256, encrypted: !!password, counts: b.manifest.counts } }));
  return b;
}

export const localBackups = () => listLocalBackups(dataDirs());

/**
 * Restores a backup file over this installation, after a safety backup. Everyone is signed out. Writes the restore
 * into the audit log of each restored gym, so the restored books say they were restored, when and from which file.
 */
export async function localRestore(u: CurrentUser, a: { file: string; password?: string; confirm: string; label: string }) {
  onlyLocal();
  superAdmin(u);
  if (a.confirm.trim() !== "RESTORE") throw new UserError("Type RESTORE to confirm. Everything on this computer will be replaced by the backup.", "confirm");
  if ((await db.organization.count()) > 1) throw new UserError("More than one gym is on this computer. Restoring would replace all of them; ask FITRON support to restore one gym.");
  try {
    const r = await restoreLocalBackup({
      dirs: dataDirs(),
      file: a.file,
      password: a.password?.trim() || undefined,
      migrationsDir: migrationsDir(),
      safetyBackup: () => localBackupNow(u, { kind: "safety" }),
    });
    // The restored database may not know this person (a backup older than their account), so the row names them only
    // when it can.
    const known = await db.user.findUnique({ where: { id: u.id }, select: { id: true } });
    for (const gym of r.manifest.gyms) {
      await db.$transaction((tx) =>
        audit(tx, { orgId: gym.id, userId: known ? u.id : null, action: "backup.local.restore", entity: "Backup", entityId: a.label, after: { backupMadeAt: r.manifest.createdAt, appVersion: r.manifest.appVersion, migrated: r.migrated, safetyBackup: r.safety.name, by: known ? undefined : u.email } }),
      );
    }
    // Reload: every database connection of FITRON is closed and reopened, so nothing goes on serving what was there
    // before the restore (no restart needed).
    await reopenLocalConnections();
    // A computer linked to fitron.in now holds older records than the website: it downloads the gym again before it
    // uploads anything, so the restore never sends old values over newer ones.
    await db.syncState.updateMany({ where: { id: 1, linked: true }, data: { needsSnapshot: true } });
    return r;
  } catch (e) {
    if (e instanceof BackupError) throw new UserError(e.message);
    throw e;
  }
}
