"use server";

import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { isLocal } from "@/lib/runtime/edition";
import { listLocalBackups } from "@/lib/runtime/fitron-backup";
import { recoverFromBackup, RecoveryRefused } from "@/lib/runtime/local-damage";
import { readDamage } from "@/lib/runtime/local-damage-marker";
import { resumeAfterRecovery } from "@/lib/runtime/local-start";
import { audit } from "@/lib/services/audit";
import { log } from "@/lib/log";

export type RecoveryState = { message?: string; email?: string; done?: { backup: string; madeAt: string; keptIn: string } } | undefined;

/** Recovery: restores the picked backup over the damaged database (src/lib/runtime/local-damage.ts), then starts FITRON. */
export async function recoverAction(_: RecoveryState, fd: FormData): Promise<RecoveryState> {
  const out = await recover(fd);
  // A refused try keeps the email typed, so only the password is entered again.
  return out?.message ? { ...out, email: String(fd.get("email") ?? "") } : out;
}

async function recover(fd: FormData): Promise<RecoveryState> {
  if (!isLocal() || !readDamage()) return { message: "The database is not damaged. Open FITRON as usual." };
  // Each try checks a password (Argon2): a few a minute.
  if (!rateLimit("local-recovery", 6, 10 * 60_000)) return { message: "Too many tries. Wait ten minutes." };
  const [kind, name] = String(fd.get("backup") ?? "").split("/");
  const backup = (await listLocalBackups()).find((b) => b.kind === kind && b.name === name);
  if (!backup) return { message: "Pick a backup from the list." };
  try {
    // Nothing has used the damaged database, but make sure no connection to it stays open while its files move.
    await db.$disconnect().catch(() => {});
    const r = await recoverFromBackup({ file: backup.file, email: String(fd.get("email") ?? ""), password: String(fd.get("password") ?? ""), backupPassword: String(fd.get("backupPassword") ?? "") });
    const state = await resumeAfterRecovery();
    if (!state.ready) return { message: `The backup was restored, but FITRON could not start on it: ${state.error ?? "unknown reason"}. The damaged files are kept in ${r.damagedKeptIn}.` };
    // A computer linked to fitron.in downloads the gym again before it uploads anything (as after any restore).
    await db.syncState.updateMany({ where: { id: 1, linked: true }, data: { needsSnapshot: true } });
    const orgId = (await db.organization.findFirst({ select: { id: true } }))?.id;
    if (orgId) await db.$transaction((tx) => audit(tx, { orgId, userId: null, action: "database.recovered", entity: "Backup", entityId: backup.name, after: { by: r.by, backupMadeAt: r.manifest.createdAt, damagedKeptIn: r.damagedKeptIn } }));
    log.warn("local.recovered", undefined, { backup: backup.name, keptIn: r.damagedKeptIn });
    return { done: { backup: backup.name, madeAt: r.manifest.createdAt, keptIn: r.damagedKeptIn } };
  } catch (e) {
    if (e instanceof RecoveryRefused) return { message: e.message };
    log.error("local.recovery_failed", e);
    return { message: `The restore did not finish: ${e instanceof Error ? e.message : String(e)}. Nothing was deleted; ask FITRON support.` };
  }
}
