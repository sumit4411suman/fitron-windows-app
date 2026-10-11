import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackupError, createLocalBackup, listLocalBackups, pruneLocalBackups, readManifest, recoverDocuments, restoreLocalBackup, unpackBackup, backupPath } from "./fitron-backup";
import { listMigrations } from "./local-migrate";
import { migrateLocal } from "./local-migrate";
import { dataDirs, type DataDirs } from "./paths";
import { ensureLocalSecrets } from "./local-secrets";
import { readTar, TarWriter } from "./tar";
import { PassThrough } from "node:stream";

// Phase 10: the .fitronbackup format and the restore steps, on real SQLite files and folders.
const MIGRATIONS = path.join(process.cwd(), "prisma", "local-migrations");
let root: string;
let dirs: DataDirs;

/** A small installation: one gym, a member, an invoice, a payment, a document. */
function seed(d: DataDirs) {
  for (const x of [d.data, d.backups, d.documents]) mkdirSync(x, { recursive: true });
  migrateLocal(d.database, MIGRATIONS);
  ensureLocalSecrets(d.root, {});
  const db = new Database(d.database);
  db.exec(`
    INSERT INTO "Organization" (id, name, "createdAt") VALUES ('org1', 'Power Haus Gym', '2026-10-01T00:00:00.000Z');
    INSERT INTO "Branch" (id, "orgId", name, address, phone, "createdAt") VALUES ('br1', 'org1', 'Main', '', '9876543210', '2026-10-01T00:00:00.000Z');
    INSERT INTO "Member" (id, code, "orgId", "branchId", name, gender, phone, source, "createdById", "createdAt", "updatedAt") VALUES ('m1', 'FT-1', 'org1', 'br1', 'Asha Verma', 'Female', '9811100001', 'Walk-in', 'u', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
    INSERT INTO "Invoice" (id, number, "orgId", "branchId", "memberId", date, "dueDate", subtotal, discount, tax, total, status, "createdById", "createdAt") VALUES ('i1', 'INV-1001', 'org1', 'br1', 'm1', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 99900, 0, 17982, 117882, 'ISSUED', 'u', '2026-10-01T00:00:00.000Z');
    INSERT INTO "Payment" (id, code, "orgId", "branchId", "invoiceId", "memberId", date, amount, method, "receivedById", "createdAt") VALUES ('p1', 'PAY-5001', 'org1', 'br1', 'i1', 'm1', '2026-10-01T00:00:00.000Z', 117882, 'UPI', 'u', '2026-10-01T00:00:00.000Z');
  `);
  db.close();
  mkdirSync(path.join(d.documents, "org1", "members", "m1"), { recursive: true });
  writeFileSync(path.join(d.documents, "org1", "members", "m1", "aadhaar.pdf"), "%PDF-1.7 the original id proof");
}

const count = (file: string, table: string) => {
  const db = new Database(file, { readonly: true });
  try {
    return Number((db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n);
  } finally {
    db.close();
  }
};
const make = (kind: "manual" | "auto" | "safety", password?: string, now?: Date) => createLocalBackup({ dirs, kind, password, appVersion: "1.0.0", now });

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fitron-bk-"));
  dirs = dataDirs(root);
  seed(dirs);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("tar", () => {
  it("round-trips long paths and empty files", async () => {
    const pt = new PassThrough();
    const w = new TarWriter(pt);
    const long = `documents/${"a".repeat(60)}/members/${"b".repeat(40)}/${"c".repeat(80)}.pdf`;
    const chunks: Buffer[] = [];
    pt.on("data", (c: Buffer) => chunks.push(c));
    await w.add(long, Buffer.from("hello"));
    await w.add("empty.txt", Buffer.alloc(0));
    await w.end();
    const got: Record<string, string> = {};
    const input = new PassThrough();
    input.end(Buffer.concat(chunks));
    await readTar(input, { target: () => null, onData: (e, c) => void (got[e.path] = (got[e.path] ?? "") + c.toString()), onDone: (e) => void (got[e.path] ??= "") });
    expect(got).toEqual({ [long]: "hello", "empty.txt": "" });
  });
});

describe("a .fitronbackup", () => {
  it("holds the database, every document and the two-step key, listed with hashes, and opens with plain tar", async () => {
    const b = await make("manual", undefined, new Date("2026-10-11T06:00:00Z"));
    expect(b.name).toBe("FITRON-Backup-2026-10-11.fitronbackup");
    expect(path.dirname(b.file)).toBe(path.join(dirs.backups, "manual"));
    expect(b.manifest).toMatchObject({ format: "fitronbackup", formatVersion: 1, appVersion: "1.0.0", kind: "manual", migrations: listMigrations(path.join(process.cwd(), "prisma", "local-migrations")).map((m) => m.name), gyms: [{ id: "org1", name: "Power Haus Gym" }] });
    expect(b.manifest.counts).toMatchObject({ Member: 1, Invoice: 1, Payment: 1 });
    expect(b.manifest.files.map((f) => f.path).sort()).toEqual(["data/fitron.db", "documents/org1/members/m1/aadhaar.pdf", "keys/biometric.key"]);
    expect(b.manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    // The second of the day gets its own name.
    expect((await make("manual", undefined, new Date("2026-10-11T07:00:00Z"))).name).toBe("FITRON-Backup-2026-10-11-2.fitronbackup");
    // Readable without FITRON: Windows 10/11 ship the same tar.
    const listing = execFileSync("tar", ["-tzf", b.file], { encoding: "utf8" });
    expect(listing.split("\n").filter(Boolean)).toEqual(["manifest.json", "data/fitron.db", "documents/org1/members/m1/aadhaar.pdf", "keys/biometric.key"]);
    expect(await readManifest(b.file)).toEqual(b.manifest);
  });

  it("with a password: unreadable without it, refused with a wrong one, complete with the right one", async () => {
    const b = await make("manual", "correct horse battery");
    expect(readFileSync(b.file).subarray(0, 11).toString()).toBe("FITRONENC1\n");
    expect(readFileSync(b.file).includes(Buffer.from("Power Haus Gym"))).toBe(false);
    await expect(readManifest(b.file)).rejects.toThrow(/has a password/);
    await expect(readManifest(b.file, "wrong password")).rejects.toThrow(/password is wrong, or the backup file is damaged/);
    expect((await readManifest(b.file, "correct horse battery")).gyms).toEqual([{ id: "org1", name: "Power Haus Gym" }]);
    const out = path.join(root, "unpacked");
    await unpackBackup(b.file, out, "correct horse battery");
    expect(readFileSync(path.join(out, "documents", "org1", "members", "m1", "aadhaar.pdf"), "utf8")).toBe("%PDF-1.7 the original id proof");
  });

  it("refuses a damaged file, and a file that is not a backup", async () => {
    for (const password of [undefined, "pw-123456"]) {
      const b = await make("manual", password);
      const bytes = readFileSync(b.file);
      bytes[Math.floor(bytes.length / 2)] ^= 0xff;
      writeFileSync(b.file, bytes);
      await expect(unpackBackup(b.file, path.join(root, `x-${password}`), password)).rejects.toBeInstanceOf(BackupError);
    }
    const junk = path.join(root, "notes.fitronbackup");
    writeFileSync(junk, "hello");
    await expect(readManifest(junk)).rejects.toThrow(/not a FITRON backup/);
  });
});

describe("restoring", () => {
  const restore = (file: string, opts: { password?: string; migrationsDir?: string } = {}) =>
    restoreLocalBackup({ dirs, file, password: opts.password, migrationsDir: opts.migrationsDir ?? MIGRATIONS, safetyBackup: () => make("safety") });

  it("puts back the database and the documents exactly, keeps a safety copy of what was there, and signs everyone out", async () => {
    const b = await make("manual", "pw-123456");
    // The app keeps its connection open the whole time, as FITRON does.
    const app = new Database(dirs.database);
    app.pragma("journal_mode = WAL");
    // And a read-only connection that has already read, as FITRON's own reader connection has.
    const reader = new Database(dirs.database, { readonly: true });
    expect(reader.prepare('SELECT COUNT(*) AS n FROM "Member"').get()).toEqual({ n: 1 });
    // Later work, which the restore must undo: a new member, a deleted document, a new document, a session.
    app.exec(`INSERT INTO "Member" (id, code, "orgId", "branchId", name, gender, phone, source, "createdById", "createdAt", "updatedAt") VALUES ('m2', 'FT-2', 'org1', 'br1', 'Ravi', 'Male', '9811100002', 'Walk-in', 'u', '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z')`);
    rmSync(path.join(dirs.documents, "org1", "members", "m1", "aadhaar.pdf"));
    writeFileSync(path.join(dirs.documents, "org1", "later.pdf"), "%PDF later");
    expect(app.prepare('SELECT COUNT(*) AS n FROM "Member"').get()).toEqual({ n: 2 });

    const r = await restore(b.file, { password: "pw-123456" });
    expect(r.migrated).toEqual([]);
    expect(app.prepare('SELECT COUNT(*) AS n FROM "Member"').get(), "the open connection sees the restored data").toEqual({ n: 1 });
    expect(reader.prepare('SELECT COUNT(*) AS n FROM "Member"').get(), "so does the open reader").toEqual({ n: 1 });
    reader.close();
    expect(app.prepare('SELECT total FROM "Invoice" WHERE id = ?').get("i1")).toEqual({ total: 117882 });
    app.close();
    expect(readFileSync(path.join(dirs.documents, "org1", "members", "m1", "aadhaar.pdf"), "utf8")).toBe("%PDF-1.7 the original id proof");
    expect(existsSync(path.join(dirs.documents, "org1", "later.pdf"))).toBe(false);
    expect(count(dirs.database, "Session")).toBe(0);
    // The safety backup has what was there just before: two members and the later document.
    const safety = await readManifest(r.safety.file);
    expect(safety.kind).toBe("safety");
    expect(safety.counts.Member).toBe(2);
    expect(safety.files.map((f) => f.path)).toContain("documents/org1/later.pdf");
    // Nothing left behind.
    expect(readdirSync(root).filter((n) => n.startsWith("restore-") || n.startsWith("documents.replaced-"))).toEqual([]);
    // The financial-row guard still holds after a restore.
    const db = new Database(dirs.database);
    expect(() => db.prepare('DELETE FROM "Payment" WHERE id = ?').run("p1")).toThrow(/not allowed/);
    db.close();
  });

  it("refuses a backup from a newer FITRON before changing anything, without even a safety backup", async () => {
    const db = new Database(dirs.database);
    db.prepare('INSERT INTO "_fitron_migrations" (name, checksum, "appliedAt") VALUES (?, ?, ?)').run("9999_from_the_future", "x", new Date().toISOString());
    db.close();
    const b = await make("manual");
    const before = readFileSync(dirs.database);
    await expect(restore(b.file)).rejects.toThrow(/made by a newer FITRON/);
    expect(readFileSync(dirs.database).equals(before)).toBe(true);
    expect(await listLocalBackups(dirs).then((l) => l.filter((x) => x.kind === "safety"))).toEqual([]);
  });

  it("brings an older backup up to this version of FITRON", async () => {
    const b = await make("manual");
    // This version has one more migration than the backup.
    const newer = path.join(root, "migrations");
    cpSync(MIGRATIONS, newer, { recursive: true });
    mkdirSync(path.join(newer, "0002_more"));
    writeFileSync(path.join(newer, "0002_more", "migration.sql"), 'CREATE TABLE "LaterTable" ("id" TEXT NOT NULL PRIMARY KEY);');
    migrateLocal(dirs.database, newer);
    const r = await restore(b.file, { migrationsDir: newer });
    expect(r.migrated).toEqual(["0002_more"]);
    expect(count(dirs.database, "LaterTable")).toBe(0);
    expect(count(dirs.database, "Member")).toBe(1);
  });

  it("changes nothing when the backup's database cannot be migrated", async () => {
    const b = await make("manual");
    const broken = path.join(root, "migrations");
    cpSync(MIGRATIONS, broken, { recursive: true });
    mkdirSync(path.join(broken, "0002_broken"));
    writeFileSync(path.join(broken, "0002_broken", "migration.sql"), "THIS IS NOT SQL;");
    const db = new Database(dirs.database);
    db.exec(`INSERT INTO "Member" (id, code, "orgId", "branchId", name, gender, phone, source, "createdById", "createdAt", "updatedAt") VALUES ('m3', 'FT-3', 'org1', 'br1', 'Kept', 'Male', '9811100003', 'Walk-in', 'u', '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z')`);
    db.close();
    await expect(restore(b.file, { migrationsDir: broken })).rejects.toThrow(/could not be brought up to this version.*Nothing was changed/);
    expect(count(dirs.database, "Member")).toBe(2);
  });

  it("puts the documents folder back at start-up if a restore stopped half-way through moving it", async () => {
    renameSync(dirs.documents, path.join(root, "documents.replaced-123"));
    expect(await recoverDocuments(dirs)).toBe(true);
    expect(readFileSync(path.join(dirs.documents, "org1", "members", "m1", "aadhaar.pdf"), "utf8")).toContain("original");
    expect(await recoverDocuments(dirs)).toBe(false);
  });
});

describe("the backups folder", () => {
  it("lists backups newest first with their kind, keeps the newest automatic ones, never removes manual ones", async () => {
    for (let d = 1; d <= 4; d++) await make("auto", undefined, new Date(`2026-10-0${d}T06:00:00Z`));
    await make("manual", "pw-123456", new Date("2026-10-05T06:00:00Z"));
    const list = await listLocalBackups(dirs);
    expect(list.map((b) => b.kind).sort()).toEqual(["auto", "auto", "auto", "auto", "manual"]);
    expect(list.find((b) => b.kind === "manual")).toMatchObject({ encrypted: true, manifest: null });
    expect(await pruneLocalBackups("auto", 2, dirs)).toHaveLength(2);
    expect((await listLocalBackups(dirs)).filter((b) => b.kind === "auto")).toHaveLength(2);
    expect((await listLocalBackups(dirs)).filter((b) => b.kind === "manual")).toHaveLength(1);
  });

  it("finds a backup by kind and name, and nothing else", async () => {
    const b = await make("manual");
    expect(backupPath("manual", b.name, dirs)).toBe(b.file);
    for (const [k, n] of [["manual", "../secrets.json"], ["../data", b.name], ["manual", "FITRON-Backup-2026-10-11.fitronbackup.exe"], ["auto", b.name]]) expect(backupPath(k!, n!, dirs)).toBeNull();
  });
});
