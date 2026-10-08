import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/integrations/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/email")>()),
  emailReady: () => true,
  sendEmail: vi.fn(async (m: (typeof mail.sent)[number]) => {
    mail.sent.push(m);
    return { sent: true as const };
  }),
}));

import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { createBackup, lastRestoreTest, restoreBackup, testRestore } from "./backup";
import { runWeeklyJobs } from "./jobs";
import { todayIso } from "./time";

type Gym = Awaited<ReturnType<typeof makeGym>>;

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "fitron-restore-test-"));
  vi.stubEnv("STORAGE_DIR", dir);
  vi.stubEnv("S3_BUCKET", "");
});
beforeEach(() => {
  mail.sent = [];
});

/** What a restore would change: the rows of the gym, counted table by table. */
async function snapshot(gym: Gym) {
  const orgId = gym.org.id;
  return {
    members: await db.member.count({ where: { orgId } }),
    invoices: await db.invoice.count({ where: { orgId } }),
    payments: await db.payment.count({ where: { orgId } }),
    users: await db.user.count({ where: { orgId, active: true, deletedAt: null } }),
    audit: await db.auditLog.count({ where: { orgId } }),
    backups: await db.backup.count({ where: { orgId } }),
    settings: await db.setting.count({ where: { orgId } }),
  };
}

/** A gym with a member, a paid sale and a backup of that. */
async function gymWithBackup(kind: "AUTO" | "MANUAL" = "AUTO") {
  const gym = await makeGym();
  const admin = pick(await gym.user("Super Admin"), gym.a.id);
  const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: true, features: [] });
  const m = await createMember(admin, { name: "Test Member", gender: "Male", phone: `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, source: "Walk-in", tags: [] });
  await sellMembership(admin, m.id, { planId: plan.id, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "UPI" });
  const backup = await createBackup(admin, kind);
  return { gym, admin, backup, planId: plan.id };
}

describe.skipIf(!hasDb)("the restore test of the latest backup (database)", () => {
  it("restores the backup for real and leaves everything as it was, including what came after the backup", async () => {
    const { gym, admin, backup, planId } = await gymWithBackup();
    const other = await makeGym();
    await createMember(pick(await other.user("Super Admin"), other.a.id), { name: "Neighbour", gender: "Male", phone: "9811100001", source: "Walk-in", tags: [] });

    // Work done after the backup: a restore would wipe all of it.
    const later = await createMember(admin, { name: "Joined After The Backup", gender: "Female", phone: "9811100002", source: "Walk-in", tags: [] });
    await sellMembership(admin, later.id, { planId, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 50000, payMethod: "Cash" });
    const newStaff = await gym.user("Receptionist");
    const before = await snapshot(gym);
    const neighbour = await snapshot(other);
    expect(before.members).toBe(2);

    const r = await testRestore(gym.org.id);
    expect(r).toMatchObject({ backup: { id: backup.id } });
    expect(r!.rows).toBeGreaterThan(10);
    expect(r!.tables).toBeGreaterThan(20);

    expect(await snapshot(gym), "nothing of the gym changed").toEqual(before);
    expect(await snapshot(other), "no other gym was touched").toEqual(neighbour);
    expect((await db.member.findUnique({ where: { id: later.id } }))?.deletedAt).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: newStaff.id } })).active, "a real restore would have deactivated staff added later").toBe(true);
    const row = await db.backup.findUniqueOrThrow({ where: { id: backup.id } });
    expect(row.restoredAt, "the backup is not marked as restored").toBeNull();
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "backup.restore" } })).toBe(0);
    expect(await db.backup.count({ where: { orgId: gym.org.id, kind: "PRE_RESTORE" } }), "no safety copy is taken").toBe(0);
  });

  it("is only a test: the same backup restored for real does change all of that", async () => {
    // The contrast that gives the test above its meaning: these are the changes a real restore makes.
    const { gym, admin, backup, planId } = await gymWithBackup();
    const later = await createMember(admin, { name: "Joined After The Backup", gender: "Female", phone: "9811100003", source: "Walk-in", tags: [] });
    await sellMembership(admin, later.id, { planId, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 50000, payMethod: "Cash" });
    const newStaff = await gym.user("Receptionist");
    const before = await snapshot(gym);

    await restoreBackup(admin, { backupId: backup.id }, "RESTORE");
    const after = await snapshot(gym);
    expect(after.members).toBe(before.members - 1);
    expect(after.invoices).toBe(before.invoices - 1);
    expect(after.backups, "and takes a safety copy").toBe(before.backups + 1);
    expect((await db.user.findUniqueOrThrow({ where: { id: newStaff.id } })).active).toBe(false);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "backup.restore" } })).toBe(1);
  });

  it("tests the newest automatic or manual backup, never a safety copy", async () => {
    const { gym, admin, backup } = await gymWithBackup("MANUAL");
    expect((await testRestore(gym.org.id))!.backup.id).toBe(backup.id);
    const auto = await createBackup(admin, "AUTO", new Date(Date.now() + 60_000));
    expect((await testRestore(gym.org.id))!.backup.id).toBe(auto.id);
    await createBackup(admin, "PRE_RESTORE", new Date(Date.now() + 120_000));
    expect((await testRestore(gym.org.id))!.backup.id).toBe(auto.id);
  });

  it("has nothing to test until there is a backup", async () => {
    const gym = await makeGym();
    await gym.user("Super Admin");
    expect(await testRestore(gym.org.id)).toBeNull();
    expect((await runWeeklyJobs(gym.org.id, "2026-10-04"))[0]).toMatchObject({ name: "backup.test", status: "ran", result: { note: "no backup yet" } });
    expect(await lastRestoreTest(gym.org.id)).toMatchObject({ ok: null, note: "no backup yet" });
    expect(mail.sent).toHaveLength(0);
  });

  it("notices a stored file that is not the one that was written", async () => {
    const { gym, backup } = await gymWithBackup();
    const file = path.join(dir, backup.storageKey);
    const text = readFileSync(file, "utf8");
    writeFileSync(file, text.replace("Test Member", "Test Mamber")); // one letter, still valid JSON
    const before = await snapshot(gym);
    await expect(testRestore(gym.org.id)).rejects.toThrow(/no longer matches its checksum/);
    expect(await snapshot(gym)).toEqual(before);
  });

  it("notices a missing file", async () => {
    const { gym, backup } = await gymWithBackup();
    writeFileSync(path.join(dir, backup.storageKey), "");
    await db.backup.update({ where: { id: backup.id }, data: { storageKey: `${gym.org.id}/backups/gone.json` } });
    await expect(testRestore(gym.org.id)).rejects.toThrow(/missing from storage/);
  });

  it("notices a backup that no longer fits the database, and still changes nothing", async () => {
    const { gym, backup } = await gymWithBackup();
    // A backup taken before a table changed: a row carries a column the table no longer has. The checksum is made to match,
    // so the failure that is left is the one the test exists for: the insert.
    const file = path.join(dir, backup.storageKey);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    parsed.tables.Member[0].columnThatWasRemoved = "x";
    const text = JSON.stringify(parsed);
    writeFileSync(file, text);
    await db.backup.update({ where: { id: backup.id }, data: { sha256: createHash("sha256").update(text).digest("hex") } });

    const before = await snapshot(gym);
    await expect(testRestore(gym.org.id)).rejects.toThrow(/columnThatWasRemoved/);
    expect(await snapshot(gym), "the failed attempt rolled back too").toEqual(before);
  });

  it("the weekly job records a pass and the Backup page reads it", async () => {
    const { gym } = await gymWithBackup();
    const run = (await runWeeklyJobs(gym.org.id, "2026-10-04"))[0]!;
    expect(run).toMatchObject({ name: "backup.test", status: "ran" });
    expect(run.result).toMatchObject({ rows: expect.any(Number), tables: expect.any(Number), ms: expect.any(Number) });
    expect(String(run.result!.backup)).toMatch(/^fitron-backup-.*\.json$/);
    expect(await lastRestoreTest(gym.org.id)).toMatchObject({ ok: true, day: "2026-10-04", rows: run.result!.rows });
    expect((await runWeeklyJobs(gym.org.id, "2026-10-04"))[0]!.status, "once a day").toBe("skipped");
    expect(mail.sent).toHaveLength(0);
  });

  it("when the test fails the job fails, the owner is told in the app and by email, and the next call tries again", async () => {
    const { gym, admin, backup } = await gymWithBackup();
    const file = path.join(dir, backup.storageKey);
    const good = readFileSync(file, "utf8");
    writeFileSync(file, good.replace("Test Member", "Test Mamber"));

    const run = (await runWeeklyJobs(gym.org.id, "2026-10-04"))[0]!;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/checksum/);
    const told = await db.notification.findMany({ where: { orgId: gym.org.id, type: "JOB_FAILED" } });
    expect(told.map((n) => n.text).join(" ")).toContain('Weekly job "Test that the latest backup restores" failed');
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: admin.email, subject: `${gym.org.name}: your latest backup could not be restored in a test` });
    expect(mail.sent[0]!.text).toContain("no longer matches its checksum");
    expect(mail.sent[0]!.text).toContain("Back up now");
    expect(await lastRestoreTest(gym.org.id)).toMatchObject({ ok: false, day: "2026-10-04" });

    // Fixed (a fresh backup is taken): the same day's next call runs it again and it passes.
    await createBackup(admin, "MANUAL", new Date(Date.now() + 60_000));
    const again = (await runWeeklyJobs(gym.org.id, "2026-10-04"))[0]!;
    expect(again.status).toBe("ran");
    expect(await lastRestoreTest(gym.org.id)).toMatchObject({ ok: true });
  });
});
