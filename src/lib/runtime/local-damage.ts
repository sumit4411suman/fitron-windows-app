import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { clearDamage, readDamage } from "./local-damage-marker";
import { randomBytes } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { verifyPassword } from "@/lib/auth/password";
import { dataDirs, type DataDirs } from "./paths";
import { integrityCheck, listMigrations, migrateLocal, migrationsDir } from "./local-migrate";
import { BackupError, unpackBackup, type BackupManifest } from "./fitron-backup";
import { writeRestoredSecrets } from "./local-secrets";

// A damaged database (a disk fault, a power cut in the middle of a write that the disk did not finish) on FITRON for
// Windows, docs/local-windows/DISASTER-RECOVERY.md:
//   detection  every start checks the database (SQLite's quick_check, about a second on years of records) before
//              anything opens it for work. A damaged one is never written to; DAMAGED.json in the data folder says so.
//   recovery   the window opens on Recovery (/recovery) instead of the app: it lists the backups on this computer and
//              restores the one a Super Admin picks, with that Super Admin's password from the backup itself. The
//              damaged files are moved aside into data/damaged-<time>/ and kept; nothing is deleted.

export { DAMAGED_FILE, clearDamage, markDamaged, readDamage, type Damage } from "./local-damage-marker";

/** SQLite's quick_check: "ok", or what is wrong. A file SQLite cannot open as a database counts as damaged too. */
export function quickCheck(file: string): { ok: boolean; problems: string[] } {
  let db: Database.Database | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true, timeout: 10_000 });
    const rows = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
    const problems = rows.map((r) => r.quick_check).filter((s) => s !== "ok");
    return { ok: problems.length === 0, problems };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (/SQLITE_(CORRUPT|NOTADB)/.test(code) || /malformed|not a database/i.test((e as Error).message)) return { ok: false, problems: [(e as Error).message] };
    throw e;
  } finally {
    db?.close();
  }
}

/** Where the damaged database's files were moved, newest first: kept for FITRON support, never deleted. */
export function damagedCopies(dirs: DataDirs = dataDirs()): string[] {
  if (!existsSync(dirs.data)) return [];
  return readdirSync(dirs.data).filter((n) => n.startsWith("damaged-")).sort().reverse().map((n) => path.join(dirs.data, n));
}

export class RecoveryRefused extends Error {}

/** A Super Admin of the gym in that database, by email and password; their name, or null. */
async function superAdminIn(file: string, email: string, password: string): Promise<string | null> {
  const db = new Database(file, { readonly: true });
  try {
    const u = db
      .prepare(`SELECT u."name", u."passwordHash" FROM "User" u JOIN "Role" r ON r."id" = u."roleId" WHERE lower(u."email") = lower(?) AND r."name" = 'Super Admin' AND u."active" = 1 AND u."deletedAt" IS NULL`)
      .get(email.trim()) as { name: string; passwordHash: string } | undefined;
    if (!u?.passwordHash) return null;
    return (await verifyPassword(u.passwordHash, password)) ? u.name : null;
  } finally {
    db.close();
  }
}

export type Recovered = { manifest: BackupManifest; damagedKeptIn: string; by: string };

/**
 * Restores a backup over a damaged database. The backup is unpacked and checked, brought up to this version and checked
 * again, and the person must be a Super Admin of that backup (their password in it): all before anything changes. Then
 * the damaged files move aside (kept), the restored database goes in, everyone is signed out, and files of the backup
 * missing from the documents folder are put back (files added since stay). Throws RecoveryRefused (in words for the
 * person) and changes nothing when any check fails.
 */
export async function recoverFromBackup(o: { file: string; email: string; password: string; backupPassword?: string; dirs?: DataDirs; migrations?: string }): Promise<Recovered> {
  const dirs = o.dirs ?? dataDirs();
  const migrations = o.migrations ?? migrationsDir();
  if (!readDamage(dirs)) throw new RecoveryRefused("The database is not damaged. Restore backups from Settings › Backup.");
  const work = path.join(dirs.root, `recover-${randomBytes(6).toString("hex")}`);
  mkdirSync(work, { recursive: true });
  try {
    let manifest: BackupManifest;
    try {
      manifest = await unpackBackup(o.file, work, o.backupPassword || undefined);
    } catch (e) {
      throw new RecoveryRefused(e instanceof BackupError ? e.message : "That backup could not be opened.");
    }
    const restored = path.join(work, "data", "fitron.db");
    const known = new Set(listMigrations(migrations).map((m) => m.name));
    if (manifest.migrations.some((n) => !known.has(n))) throw new RecoveryRefused(`This backup was made by a newer FITRON (${manifest.appVersion}). Install that version, then restore it.`);
    if (!integrityCheck(restored).ok) throw new RecoveryRefused("The database inside this backup is damaged too. Pick an older backup.");
    const by = await superAdminIn(restored, o.email, o.password);
    if (!by) throw new RecoveryRefused("Only a Super Admin of the gym in this backup can restore it: enter their email and the password they had when the backup was made.");
    try {
      migrateLocal(restored, migrations);
    } catch (e) {
      throw new RecoveryRefused(`This backup could not be brought up to this version of FITRON (${(e as Error).message}). Nothing was changed.`);
    }
    if (!integrityCheck(restored).ok) throw new RecoveryRefused("The restored database failed its check. Nothing was changed.");
    const fresh = new Database(restored);
    try {
      fresh.exec('DELETE FROM "Session";');
      fresh.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      fresh.close();
    }

    // From here on the installation changes. The damaged files are moved, not deleted.
    const kept = path.join(dirs.data, `damaged-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    mkdirSync(kept, { recursive: true });
    for (const side of ["", "-wal", "-shm", "-journal"]) {
      const f = `${dirs.database}${side}`;
      if (existsSync(f)) renameSync(f, path.join(kept, path.basename(f)));
    }
    copyFileSync(restored, dirs.database);
    // Documents: the folder is not part of the damage. Files the backup has and the folder lost come back.
    const docs = path.join(work, "documents");
    if (existsSync(docs)) {
      for (const e of readdirSync(docs, { recursive: true, withFileTypes: true })) {
        if (!e.isFile()) continue;
        const rel = path.relative(docs, path.join(e.parentPath, e.name));
        const to = path.join(dirs.documents, rel);
        if (!existsSync(to)) {
          mkdirSync(path.dirname(to), { recursive: true });
          copyFileSync(path.join(e.parentPath, e.name), to);
        }
      }
    }
    const key = path.join(work, "keys", "biometric.key");
    if (existsSync(key)) writeRestoredSecrets(dirs.root, process.env, { BIOMETRIC_KEY: readFileSync(key, "utf8").trim() });
    writeFileSync(path.join(kept, "README.txt"), `FITRON found this database damaged on ${readDamage(dirs)?.at || "start-up"} and restored the backup ${path.basename(o.file)} (made ${manifest.createdAt}). These are the damaged files, kept as they were. Do not delete them before FITRON support has looked at them if records after the backup are needed.\n`);
    clearDamage(dirs);
    return { manifest, damagedKeptIn: kept, by };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
