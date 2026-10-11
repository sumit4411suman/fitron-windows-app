import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listLocalBackups } from "./fitron-backup";
import { startLocalEdition } from "./local-start";
import { dataDirs } from "./paths";

// Phase 15: an update replaces the program, never the gym's data. The first start of the new version backs the
// database up before it changes it, and changes nothing if that backup cannot be made.

let root: string;
let migrations: string;
const dirs = () => dataDirs(root);
const applied = () => {
  const db = new Database(dirs().database, { readonly: true });
  try {
    return (db.prepare(`SELECT "name" FROM "_fitron_migrations" ORDER BY "name"`).all() as { name: string }[]).map((r) => r.name);
  } finally {
    db.close();
  }
};
const safety = async () => (await listLocalBackups(dirs())).filter((b) => b.kind === "safety");

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fitron-update-"));
  migrations = path.join(root, "..", `${path.basename(root)}-migrations`);
  cpSync(path.join(process.cwd(), "prisma", "local-migrations"), migrations, { recursive: true });
  vi.stubEnv("FITRON_DATA_DIR", root);
  vi.stubEnv("FITRON_MIGRATIONS_DIR", migrations);
  vi.stubEnv("FITRON_LOCAL_SCHEDULER", "off");
  vi.stubEnv("FITRON_SHELL", "");
  vi.stubEnv("DATABASE_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
  rmSync(migrations, { recursive: true, force: true });
});

/** A new version of FITRON with one more migration. */
function nextVersion(name = "9999_update_test") {
  mkdirSync(path.join(migrations, name));
  writeFileSync(path.join(migrations, name, "migration.sql"), `CREATE TABLE "_update_test" ("id" INTEGER PRIMARY KEY);\n`);
  return name;
}

describe("starting FITRON after an update", () => {
  it("makes no safety backup on a first start, or a start with nothing to update", async () => {
    const first = await startLocalEdition();
    expect(first).toMatchObject({ ready: true, applied: ["0001_init"] });
    expect(first.safetyBackup).toBeUndefined();
    const again = await startLocalEdition();
    expect(again).toMatchObject({ ready: true, applied: [] });
    expect(await safety()).toHaveLength(0);
  });

  it("backs the database up before an update changes it", async () => {
    await startLocalEdition();
    const name = nextVersion();
    const s = await startLocalEdition();
    expect(s.ready).toBe(true);
    expect(s.applied).toEqual([name]);
    const [b] = await safety();
    expect(b.name).toBe(s.safetyBackup);
    // The backup holds the database as it was before the update.
    expect(b.manifest?.migrations).toEqual(["0001_init"]);
    expect(b.manifest?.note).toContain(name);
    expect(applied()).toEqual(["0001_init", name]);
  });

  it("changes nothing when the safety backup cannot be made", async () => {
    await startLocalEdition();
    nextVersion();
    // Something in the way of the safety backups' folder.
    writeFileSync(path.join(dirs().backups, "safety"), "not a folder");
    const s = await startLocalEdition();
    expect(s.ready).toBe(false);
    expect(s.error).toBeTruthy();
    expect(applied()).toEqual(["0001_init"]);
    expect(readdirSync(dirs().backups)).toEqual(["safety"]);
  });
});
