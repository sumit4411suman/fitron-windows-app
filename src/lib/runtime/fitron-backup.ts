import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import Database from "better-sqlite3";
import { encryptionHeader, fileKind, openEncrypted } from "./backup-crypto";
import { integrityCheck, listMigrations, migrateLocal, MIGRATIONS_TABLE } from "./local-migrate";
import { dataDirs, type DataDirs } from "./paths";
import { readLocalSecrets, writeRestoredSecrets } from "./local-secrets";
import { readTar, safeEntryPath, TarWriter } from "./tar";

// FITRON Local Edition backups: one .fitronbackup file holds the whole installation.
//
//   manifest.json            format, app version, schema (migrations applied), when, what kind, row counts, gyms,
//                            and the SHA-256 and size of every other entry
//   data/fitron.db           a consistent snapshot of the database (SQLite online backup, taken while FITRON runs)
//   documents/…              every stored file: member documents and photos, staff photos, logos
//   keys/biometric.key       the key that seals two-step secrets, so staff two-step codes work on a new computer
//
// gzip-compressed tar, optionally encrypted with a password (backup-crypto.ts). Files live in <data>\backups\<kind>\,
// named FITRON-Backup-YYYY-MM-DD[-n].fitronbackup. The list of backups is read from those folders, not from the
// database, so it survives the database being lost.

export const BACKUP_FORMAT = "fitronbackup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_EXT = ".fitronbackup";
export type LocalBackupKind = "manual" | "auto" | "safety";
export const BACKUP_KINDS: LocalBackupKind[] = ["manual", "auto", "safety"];

export type ManifestFile = { path: string; size: number; sha256: string };
export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  createdAt: string;
  kind: LocalBackupKind;
  note?: string;
  installationId: string;
  migrations: string[];
  gyms: { id: string; name: string }[];
  counts: Record<string, number>;
  files: ManifestFile[];
};

/** A backup FITRON will not use, with the reason in words for the person restoring it. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

const COUNTED = ["Organization", "Member", "Membership", "Invoice", "Payment", "Expense", "Attendance", "AuditLog", "MemberDocument"] as const;

const sha256File = async (file: string) => {
  const h = createHash("sha256");
  for await (const c of createReadStream(file)) h.update(c as Buffer);
  return h.digest("hex");
};

async function walk(dir: string, rel = ""): Promise<{ rel: string; abs: string }[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { rel: string; abs: string }[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".fitron-tmp-")) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), r)));
    else if (e.isFile()) out.push({ rel: r, abs: path.join(dir, e.name) });
  }
  return out;
}

/** What the snapshot holds: schema version, gyms and row counts, read from the copied file itself. */
function describeDb(file: string) {
  const db = new Database(file, { readonly: true });
  try {
    const migrations = (db.prepare(`SELECT "name" FROM "${MIGRATIONS_TABLE}" ORDER BY "name"`).all() as { name: string }[]).map((r) => r.name);
    const gyms = db.prepare(`SELECT "id", "name" FROM "Organization" ORDER BY "createdAt"`).all() as { id: string; name: string }[];
    const counts: Record<string, number> = {};
    for (const t of COUNTED) counts[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number | bigint }).n);
    return { migrations, gyms, counts };
  } finally {
    db.close();
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** FITRON-Backup-2026-10-11.fitronbackup, then -2, -3… for more on the same day. India's date. */
async function freeName(dir: string, now: Date): Promise<string> {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = `${ist.getUTCFullYear()}-${pad2(ist.getUTCMonth() + 1)}-${pad2(ist.getUTCDate())}`;
  for (let n = 1; ; n++) {
    const name = `FITRON-Backup-${day}${n > 1 ? `-${n}` : ""}${BACKUP_EXT}`;
    if (!existsSync(path.join(dir, name))) return name;
  }
}

export type CreateOptions = { dirs?: DataDirs; kind: LocalBackupKind; password?: string; note?: string; appVersion: string; now?: Date; installationId?: string; destDir?: string };
export type CreatedBackup = { file: string; name: string; size: number; sha256: string; manifest: BackupManifest };

export async function createLocalBackup(o: CreateOptions): Promise<CreatedBackup> {
  const dirs = o.dirs ?? dataDirs();
  const destDir = o.destDir ?? path.join(dirs.backups, o.kind);
  await mkdir(destDir, { recursive: true });
  const work = path.join(dirs.backups, `.tmp-${randomBytes(6).toString("hex")}`);
  await mkdir(work, { recursive: true });
  try {
    // 1. The database, copied page by page while FITRON keeps running: the copy is one consistent moment.
    const snapshot = path.join(work, "fitron.db");
    const live = new Database(dirs.database, { readonly: true, timeout: 10_000 });
    try {
      await live.backup(snapshot);
    } finally {
      live.close();
    }
    const check = integrityCheck(snapshot);
    if (!check.ok) throw new BackupError(`The database failed its integrity check, so it was not backed up: ${check.problems.slice(0, 3).join("; ")}. See TROUBLESHOOTING.md.`);
    const { migrations, gyms, counts } = describeDb(snapshot);

    // 2. What goes in, with each entry's size and hash.
    const entries: { path: string; abs?: string; body?: Buffer }[] = [{ path: "data/fitron.db", abs: snapshot }];
    for (const f of await walk(dirs.documents)) entries.push({ path: `documents/${f.rel}`, abs: f.abs });
    // The installation id and the two-step key go with the backup (a replacement laptop needs the key).
    const secrets = readLocalSecrets(dirs.root);
    const installationId = o.installationId || secrets.installationId || "";
    if (secrets.BIOMETRIC_KEY) entries.push({ path: "keys/biometric.key", body: Buffer.from(secrets.BIOMETRIC_KEY, "utf8") });
    const files: ManifestFile[] = [];
    for (const e of entries) {
      if (!safeEntryPath(e.path)) throw new BackupError(`A file name cannot go into a backup: ${e.path}`);
      if (e.body) files.push({ path: e.path, size: e.body.length, sha256: createHash("sha256").update(e.body).digest("hex") });
      else files.push({ path: e.path, size: (await stat(e.abs!)).size, sha256: await sha256File(e.abs!) });
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: o.appVersion,
      createdAt: (o.now ?? new Date()).toISOString(),
      kind: o.kind,
      ...(o.note ? { note: o.note } : {}),
      installationId,
      migrations,
      gyms,
      counts,
      files,
    };

    // 3. The archive: manifest first, so the list of backups can read it without unpacking the rest.
    const name = await freeName(destDir, o.now ?? new Date());
    const partial = path.join(work, name);
    const out = createWriteStream(partial, { mode: 0o600 });
    const gzip = createGzip({ level: 6 });
    let done: Promise<void>;
    if (o.password) {
      const { header, cipher } = await encryptionHeader(o.password);
      await new Promise<void>((r, j) => out.write(header, (e) => (e ? j(e) : r())));
      done = pipeline(gzip, cipher, out, { end: false }).then(
        () =>
          new Promise<void>((r, j) => {
            out.write(cipher.getAuthTag(), (e) => (e ? j(e) : out.end(() => r())));
          }),
      );
    } else done = pipeline(gzip, out);
    const tar = new TarWriter(gzip);
    await tar.add("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.body) await tar.add(e.path, e.body);
      else await tar.addFile(e.path, e.abs!, files[i]!.size);
    }
    await tar.end();
    await done;

    // 4. Into place in one step: a half-written backup never appears under a backup's name.
    const file = path.join(destDir, name);
    await rename(partial, file);
    return { file, name, size: (await stat(file)).size, sha256: await sha256File(file), manifest };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** The decompressed archive stream of a backup file, decrypting it first if it has a password. */
async function archiveStream(file: string, password?: string): Promise<{ stream: Readable; encrypted: boolean }> {
  const kind = await fileKind(file);
  if (kind === "unknown") throw new BackupError("This is not a FITRON backup file.");
  if (kind === "gzip") return { stream: createReadStream(file).pipe(createGunzip()), encrypted: false };
  if (!password) throw new BackupError("This backup has a password. Enter it to restore.");
  const { decipher, start, end } = await openEncrypted(file, password);
  const src = createReadStream(file, { start, end });
  const gunzip = createGunzip();
  src.pipe(decipher).pipe(gunzip);
  // A wrong password or a damaged file shows up as the decipher's error at the end.
  decipher.on("error", (e) => gunzip.destroy(e));
  src.on("error", (e) => gunzip.destroy(e));
  return { stream: gunzip, encrypted: true };
}

const WRONG = "The password is wrong, or the backup file is damaged.";

/** Reads only the manifest (the first entry). Fast for unencrypted backups. */
export async function readManifest(file: string, password?: string): Promise<BackupManifest> {
  const { stream, encrypted } = await archiveStream(file, password);
  let text = "";
  const stop = new Error("manifest read");
  try {
    await readTar(stream, {
      target: () => null,
      onData: (e, c) => {
        if (e.path === "manifest.json") text += c.toString("utf8");
      },
      onDone: (e) => {
        if (e.path === "manifest.json") throw stop;
        throw new BackupError("This backup file is damaged (its contents list is missing).");
      },
    });
  } catch (e) {
    if (e !== stop) {
      if (e instanceof BackupError) throw e;
      throw new BackupError(encrypted ? WRONG : "This backup file is damaged and cannot be read.");
    }
  } finally {
    stream.destroy();
  }
  return parseManifest(text);
}

function parseManifest(text: string): BackupManifest {
  let m: BackupManifest;
  try {
    m = JSON.parse(text) as BackupManifest;
  } catch {
    throw new BackupError("This backup file is damaged (its contents list cannot be read).");
  }
  if (m.format !== BACKUP_FORMAT || !Array.isArray(m.files) || !Array.isArray(m.migrations)) throw new BackupError("This is not a FITRON backup file.");
  if (m.formatVersion > BACKUP_FORMAT_VERSION) throw new BackupError(`This backup was made by a newer FITRON (${m.appVersion}). Update FITRON, then restore it.`);
  return m;
}

/**
 * Unpacks a backup into `dest`, checking every file against the manifest's size and SHA-256. Anything missing, extra,
 * or different is refused: nothing from a backup is used unless all of it is exactly what was saved.
 */
export async function unpackBackup(file: string, dest: string, password?: string): Promise<BackupManifest> {
  const { stream, encrypted } = await archiveStream(file, password);
  let manifestText = "";
  const seen = new Map<string, { size: number; hash: ReturnType<typeof createHash> }>();
  try {
    await readTar(stream, {
      target: (e) => (e.path === "manifest.json" ? null : path.join(dest, ...e.path.split("/"))),
      onData: (e, c) => {
        if (e.path === "manifest.json") manifestText += c.toString("utf8");
        else {
          const s = seen.get(e.path) ?? { size: 0, hash: createHash("sha256") };
          s.size += c.length;
          s.hash.update(c);
          seen.set(e.path, s);
        }
      },
      onDone: (e) => void (e.path !== "manifest.json" && !seen.has(e.path) && seen.set(e.path, { size: 0, hash: createHash("sha256") })),
    });
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError(encrypted ? WRONG : `This backup file is damaged and cannot be restored (${(e as Error).message}).`);
  }
  const m = parseManifest(manifestText);
  const listed = new Map(m.files.map((f) => [f.path, f]));
  for (const [p, s] of seen) {
    const f = listed.get(p);
    if (!f) throw new BackupError(`This backup file is damaged: it holds a file it does not list (${p}).`);
    if (f.size !== s.size || f.sha256 !== s.hash.digest("hex")) throw new BackupError(`This backup file is damaged: ${p} is not what was saved.`);
  }
  for (const p of listed.keys()) if (!seen.has(p)) throw new BackupError(`This backup file is damaged: ${p} is missing from it.`);
  if (!listed.has("data/fitron.db")) throw new BackupError("This backup has no database in it.");
  return m;
}

export type RestoreOptions = {
  dirs?: DataDirs;
  file: string;
  password?: string;
  migrationsDir: string;
  /** Takes the safety backup of what is there now. Called after the file has been checked, before anything changes. */
  safetyBackup: () => Promise<CreatedBackup>;
  /** Writes into the restored database before it is used (the audit row of the restore). */
  afterRestore?: (info: { manifest: BackupManifest; safety: CreatedBackup; migrated: string[] }) => Promise<void>;
  /** The database to restore into, when not dirs.database (tests). */
  liveDatabase?: string;
};

export type RestoreResult = { manifest: BackupManifest; safety: CreatedBackup; migrated: string[] };

/**
 * Restores a backup over this installation:
 *   1. unpack and check every file (unpackBackup)        5. copy the database in (SQLite online backup) and the
 *   2. refuse a backup from a newer FITRON                  documents folder, and the two-step key
 *   3. take a safety backup of what is here now           6. sign everybody out
 *   4. bring the backup's database up to this version     7. check the restored database's integrity and counts
 *      on a separate copy (a failed migration changes      8. tidy up
 *      nothing here)
 * Nothing here changes before step 5; if any step before it fails, the installation is as it was.
 */
export async function restoreLocalBackup(o: RestoreOptions): Promise<RestoreResult> {
  const dirs = o.dirs ?? dataDirs();
  const liveDb = o.liveDatabase ?? dirs.database;
  const work = path.join(dirs.root, `restore-${randomBytes(6).toString("hex")}`);
  await mkdir(work, { recursive: true });
  try {
    const manifest = await unpackBackup(o.file, work, o.password);
    const restoredDb = path.join(work, "data", "fitron.db");

    const known = new Set(listMigrations(o.migrationsDir).map((m) => m.name));
    const unknown = manifest.migrations.filter((n) => !known.has(n));
    if (unknown.length) throw new BackupError(`This backup was made by a newer FITRON (${manifest.appVersion}). Update FITRON, then restore it.`);
    const before = integrityCheck(restoredDb);
    if (!before.ok) throw new BackupError("The database inside this backup is damaged, so it was not restored.");

    const safety = await o.safetyBackup();

    let migrated: string[];
    try {
      migrated = migrateLocal(restoredDb, o.migrationsDir).applied;
    } catch (e) {
      throw new BackupError(`This backup could not be brought up to this version of FITRON (${(e as Error).message}). Nothing was changed.`);
    }
    if (!integrityCheck(restoredDb).ok) throw new BackupError("The restored database failed its integrity check. Nothing was changed.");

    // 5. Database: copied in as one ordinary transaction (copyDatabaseInto), so FITRON's open connections see the
    //    restored data on their next query, with no restart and no file swapped under them, and a failure half-way
    //    leaves the live database exactly as it was.
    copyDatabaseInto(restoredDb, liveDb);
    // Documents: the old folder is moved aside, the backup's moved in, then the old one removed (its files are in the
    // safety backup). If FITRON stops between the two moves, start-up moves the old folder back (recoverDocuments).
    const restoredDocs = path.join(work, "documents");
    await mkdir(restoredDocs, { recursive: true });
    const aside = path.join(dirs.root, `documents.replaced-${Date.now()}`);
    if (existsSync(dirs.documents)) await rename(dirs.documents, aside);
    await rename(restoredDocs, dirs.documents);
    await rm(aside, { recursive: true, force: true });
    // Two-step key: the restored staff secrets were sealed with the backup's key.
    const key = path.join(work, "keys", "biometric.key");
    if (existsSync(key)) writeRestoredSecrets(dirs.root, process.env, { BIOMETRIC_KEY: (await readFile(key, "utf8")).trim() });

    // 6–7. Everyone was signed out inside the copy (the sessions in a backup are old); check what is now live.
    const after = integrityCheck(liveDb);
    if (!after.ok) throw new BackupError(`The restored database failed its integrity check: ${after.problems.slice(0, 3).join("; ")}. Restore the safety backup ${safety.name}.`);
    if (!migrated.length) {
      const now = describeDb(liveDb).counts;
      for (const [t, n] of Object.entries(manifest.counts)) if (now[t] !== n) throw new BackupError(`After the restore, ${t} has ${now[t]} rows but the backup has ${n}. Restore the safety backup ${safety.name}.`);
    }
    await o.afterRestore?.({ manifest, safety, migrated });
    return { manifest, safety, migrated };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Replaces every table of `liveDb` with the rows of `restoredDb` (same schema: both are at this version's migrations),
 * in one transaction on a connection of its own. Triggers are dropped for the copy and re-created from the restored
 * database's own definitions, so the financial-row guard and the append-only audit log are back before the commit.
 * Sessions are emptied: everyone signs in again. Exported for its test.
 */
export function copyDatabaseInto(restoredDb: string, liveDb: string) {
  const live = new Database(liveDb, { timeout: 30_000 });
  try {
    live.pragma("foreign_keys = ON");
    live.prepare("ATTACH DATABASE ? AS r").run(restoredDb);
    const objects = (schema: "main" | "r", type: string) =>
      (live.prepare(`SELECT name, sql FROM ${schema}.sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'`).all(type) as { name: string; sql: string }[]);
    const tables = objects("r", "table").map((t) => t.name).sort();
    const liveTables = objects("main", "table").map((t) => t.name).sort();
    if (tables.join() !== liveTables.join()) throw new BackupError("The backup's tables do not match this version of FITRON after migration. Nothing was changed.");
    const q = (n: string) => `"${n.replace(/"/g, '""')}"`;
    live.transaction(() => {
      live.pragma("defer_foreign_keys = ON");
      for (const t of objects("main", "trigger")) live.exec(`DROP TRIGGER ${q(t.name)}`);
      for (const t of tables) {
        const cols = (live.prepare(`SELECT name FROM pragma_table_info(?, 'r')`).all(t) as { name: string }[]).map((c) => q(c.name)).join(", ");
        live.exec(`DELETE FROM main.${q(t)}`);
        live.exec(`INSERT INTO main.${q(t)} (${cols}) SELECT ${cols} FROM r.${q(t)}`);
      }
      const hasSeq = (schema: string) => !!live.prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE name = 'sqlite_sequence'`).get();
      if (hasSeq("main")) {
        live.exec("DELETE FROM main.sqlite_sequence");
        if (hasSeq("r")) live.exec("INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM r.sqlite_sequence");
      }
      live.exec('DELETE FROM main."Session"; DELETE FROM main."_fitron_guard";');
      for (const t of objects("r", "trigger")) live.exec(t.sql);
      const broken = live.prepare("SELECT * FROM main.pragma_foreign_key_check").all();
      if (broken.length) throw new BackupError(`The backup's records do not fit together (${broken.length} broken links). Nothing was changed.`);
    })();
  } finally {
    try {
      live.exec("DETACH DATABASE r");
    } catch {
      // not attached
    }
    live.close();
  }
}

/** Start-up repair: a restore stopped between moving the documents folder aside and moving the restored one in. */
export async function recoverDocuments(dirs: DataDirs = dataDirs()): Promise<boolean> {
  if (existsSync(dirs.documents)) return false;
  const aside = (await readdir(dirs.root)).filter((n) => n.startsWith("documents.replaced-")).sort().pop();
  if (!aside) return false;
  await rename(path.join(dirs.root, aside), dirs.documents);
  return true;
}

export type BackupListItem = { kind: LocalBackupKind; name: string; file: string; size: number; modifiedAt: Date; encrypted: boolean; manifest: BackupManifest | null };

/** Every backup in the backups folder, newest first. Read from the files themselves. */
export async function listLocalBackups(dirs: DataDirs = dataDirs()): Promise<BackupListItem[]> {
  const out: BackupListItem[] = [];
  for (const kind of BACKUP_KINDS) {
    const dir = path.join(dirs.backups, kind);
    let names: string[] = [];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith(BACKUP_EXT));
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      const s = await stat(file);
      const encrypted = (await fileKind(file)) === "encrypted";
      const manifest = encrypted ? null : await readManifest(file).catch(() => null);
      out.push({ kind, name, file, size: s.size, modifiedAt: s.mtime, encrypted, manifest });
    }
  }
  return out.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

/** Keeps the newest `keep` backups of a kind and removes older ones. Manual backups are never removed. */
export async function pruneLocalBackups(kind: Exclude<LocalBackupKind, "manual">, keep: number, dirs: DataDirs = dataDirs()): Promise<string[]> {
  const all = (await listLocalBackups(dirs)).filter((b) => b.kind === kind);
  const gone = all.slice(keep);
  for (const b of gone) await rm(b.file, { force: true });
  return gone.map((b) => b.name);
}

/** The path of a backup by kind and name, refusing anything that is not a plain backup file name in that folder. */
export function backupPath(kind: string, name: string, dirs: DataDirs = dataDirs()): string | null {
  if (!BACKUP_KINDS.includes(kind as LocalBackupKind)) return null;
  if (!/^FITRON-Backup-\d{4}-\d{2}-\d{2}(-\d+)?\.fitronbackup$/.test(name)) return null;
  const p = path.join(dirs.backups, kind, name);
  return existsSync(p) ? p : null;
}

