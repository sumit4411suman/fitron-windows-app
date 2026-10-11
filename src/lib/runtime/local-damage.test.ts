import { existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, writeSync, closeSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { isLocal } from "./edition";
import { dataDirs, type DataDirs } from "./paths";
import { migrateLocal } from "./local-migrate";
import { makeLocalClient } from "./local-client";
import { createLocalBackup } from "./fitron-backup";
import { damagedCopies, markDamaged, quickCheck, readDamage, recoverFromBackup, RecoveryRefused } from "./local-damage";
import { createLocalGym } from "@/lib/services/local-setup";

// A damaged database on FITRON for Windows (docs/local-windows/DISASTER-RECOVERY.md): found by the start-up check,
// never written to, and replaced by a backup only by a Super Admin of that backup; the damaged files are kept.

const MIGRATIONS = path.join(process.cwd(), "prisma", "local-migrations");
const OWNER = { email: "owner@damage.test", password: "Damage-test-password-1" };

/** A data folder with a gym in its database and one backup of it. */
async function installation(): Promise<{ dirs: DataDirs; backup: string }> {
  const dirs = dataDirs(mkdtempSync(path.join(os.tmpdir(), "fitron-damage-")));
  for (const d of [dirs.data, dirs.backups, dirs.documents]) mkdirSync(d, { recursive: true });
  migrateLocal(dirs.database, MIGRATIONS);
  const client = makeLocalClient(`file:${dirs.database}`);
  await createLocalGym({ gymName: "Damage Gym", branchName: "Main", address: "", ownerName: "Owner", email: OWNER.email, phone: "9876500001", password: OWNER.password, confirm: OWNER.password }, client as never);
  await client.$disconnect();
  const b = await createLocalBackup({ dirs, kind: "manual", appVersion: "1.0.0" });
  return { dirs, backup: b.file };
}

/** Overwrites pages in the middle of the file with zeros, as a failing disk sector would. */
function damagePages(file: string) {
  const db = new Database(file);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  const page = 4096;
  const pages = Math.floor(statSync(file).size / page);
  const fd = openSync(file, "r+");
  for (let p = Math.floor(pages / 2); p < Math.floor(pages / 2) + 3; p++) writeSync(fd, Buffer.alloc(page, 0), 0, page, p * page);
  closeSync(fd);
}

describe.skipIf(!isLocal())("a damaged database on FITRON for Windows", () => {
  let inst: Awaited<ReturnType<typeof installation>>;
  beforeEach(async () => {
    inst = await installation();
  });

  it("finds damage in the pages and in the file's header, and passes a healthy database", () => {
    expect(quickCheck(inst.dirs.database)).toEqual({ ok: true, problems: [] });
    damagePages(inst.dirs.database);
    const pages = quickCheck(inst.dirs.database);
    expect(pages.ok).toBe(false);
    expect(pages.problems.length).toBeGreaterThan(0);
    const fd = openSync(inst.dirs.database, "r+");
    writeSync(fd, Buffer.from("this is not a database at all!!"), 0, 31, 0);
    closeSync(fd);
    expect(quickCheck(inst.dirs.database)).toMatchObject({ ok: false, problems: [expect.stringMatching(/not a database/i)] });
  });

  it("restores a backup only for a Super Admin of that backup, keeps the damaged files, and leaves a working database", async () => {
    damagePages(inst.dirs.database);
    const damagedBytes = readFileSync(inst.dirs.database);
    markDamaged(quickCheck(inst.dirs.database).problems, inst.dirs);
    const base = { file: inst.backup, dirs: inst.dirs, migrations: MIGRATIONS };

    await expect(recoverFromBackup({ ...base, email: OWNER.email, password: "wrong-password-123" })).rejects.toThrow(RecoveryRefused);
    await expect(recoverFromBackup({ ...base, email: "someone@else.test", password: OWNER.password })).rejects.toThrow(/Only a Super Admin/);
    // Refused: nothing moved, nothing changed.
    expect(readFileSync(inst.dirs.database).equals(damagedBytes)).toBe(true);
    expect(damagedCopies(inst.dirs)).toEqual([]);
    expect(readDamage(inst.dirs)).not.toBeNull();

    const r = await recoverFromBackup({ ...base, email: OWNER.email.toUpperCase(), password: OWNER.password });
    expect(r.by).toBe("Owner");
    expect(readDamage(inst.dirs)).toBeNull();
    expect(quickCheck(inst.dirs.database).ok).toBe(true);
    const db = new Database(inst.dirs.database, { readonly: true });
    expect((db.prepare(`SELECT name FROM "Organization"`).get() as { name: string }).name).toBe("Damage Gym");
    expect(db.prepare(`SELECT COUNT(*) AS n FROM "Session"`).get()).toEqual({ n: 0 });
    db.close();
    // The damaged database, byte for byte, beside a note saying what happened.
    const [kept] = damagedCopies(inst.dirs);
    expect(readFileSync(path.join(kept!, "fitron.db")).equals(damagedBytes)).toBe(true);
    expect(readdirSync(kept!)).toContain("README.txt");
  });

  it("does nothing when the database is not damaged", async () => {
    await expect(recoverFromBackup({ file: inst.backup, dirs: inst.dirs, migrations: MIGRATIONS, email: OWNER.email, password: OWNER.password })).rejects.toThrow(/not damaged/);
    expect(existsSync(inst.dirs.database)).toBe(true);
  });
});
