import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// Applies prisma/local-migrations to the Local Edition's SQLite file. The shipped application has no Prisma CLI, so this
// small runner does what `prisma migrate deploy` does: each folder is applied once, in name order, inside one
// transaction, and recorded in _fitron_migrations with the checksum of its SQL. A changed checksum of an applied
// migration is an error (the file on disk is not what the database was built from), never silently re-run.
//
// It uses its own short-lived connection, so it can run before Prisma opens the file (src/instrumentation.ts) and from
// the backup/restore code with the app's connection closed.

export type AppliedMigration = { name: string; checksum: string; appliedAt: string };
export type MigrateResult = { applied: string[]; pending: string[]; alreadyApplied: AppliedMigration[] };

export const MIGRATIONS_TABLE = "_fitron_migrations";

/** The folder holding the migrations: FITRON_MIGRATIONS_DIR (set by the desktop shell), else the repository's. */
export function migrationsDir(env: Record<string, string | undefined> = process.env): string {
  const given = env.FITRON_MIGRATIONS_DIR?.trim();
  if (given) return path.resolve(given);
  return path.join(process.cwd(), "prisma", "local-migrations");
}

export function listMigrations(dir = migrationsDir()): { name: string; sql: string; checksum: string }[] {
  if (!existsSync(dir)) throw new Error(`Local migrations folder not found: ${dir}`);
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, "migration.sql")))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

export function openForMigration(file: string): Database.Database {
  const db = new Database(file, { timeout: 10_000 });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = FULL");
  db.exec(`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" ("name" TEXT NOT NULL PRIMARY KEY, "checksum" TEXT NOT NULL, "appliedAt" TEXT NOT NULL)`);
  return db;
}

export function appliedMigrations(db: Database.Database): AppliedMigration[] {
  return db.prepare(`SELECT "name", "checksum", "appliedAt" FROM "${MIGRATIONS_TABLE}" ORDER BY "name"`).all() as AppliedMigration[];
}

/** What would be applied, without applying it. */
export function pendingMigrations(file: string, dir = migrationsDir()): string[] {
  const db = openForMigration(file);
  try {
    const done = new Set(appliedMigrations(db).map((m) => m.name));
    return listMigrations(dir).filter((m) => !done.has(m.name)).map((m) => m.name);
  } finally {
    db.close();
  }
}

/**
 * Applies every pending migration. `file` is the SQLite path (not a file: URL). Throws on the first failure, leaving
 * the database as it was before that migration (each one is its own transaction).
 */
export function migrateLocal(file: string, dir = migrationsDir()): MigrateResult {
  const db = openForMigration(file);
  try {
    const all = listMigrations(dir);
    const done = appliedMigrations(db);
    const doneBy = new Map(done.map((m) => [m.name, m]));
    for (const m of all) {
      const prev = doneBy.get(m.name);
      if (prev && prev.checksum !== m.checksum) throw new Error(`Migration ${m.name} was applied with different SQL (checksum ${prev.checksum.slice(0, 12)}, file ${m.checksum.slice(0, 12)}).`);
    }
    const applied: string[] = [];
    for (const m of all) {
      if (doneBy.has(m.name)) continue;
      const run = db.transaction(() => {
        db.exec(m.sql);
        db.prepare(`INSERT INTO "${MIGRATIONS_TABLE}" ("name", "checksum", "appliedAt") VALUES (?, ?, ?)`).run(m.name, m.checksum, new Date().toISOString());
      });
      run();
      applied.push(m.name);
    }
    const pending = all.filter((m) => !doneBy.has(m.name) && !applied.includes(m.name)).map((m) => m.name);
    return { applied, pending, alreadyApplied: done };
  } finally {
    db.close();
  }
}

/** PRAGMA integrity_check, as SQLite reports it: "ok" or a list of problems. */
export function integrityCheck(file: string): { ok: boolean; problems: string[] } {
  const db = new Database(file, { readonly: true, timeout: 10_000 });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    const problems = rows.map((r) => r.integrity_check).filter((s) => s !== "ok");
    return { ok: problems.length === 0, problems };
  } finally {
    db.close();
  }
}
