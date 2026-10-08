import { beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { putSetting, getSetting } from "./settings";
import { backupNudge, backupStatus, createBackup, listBackups, pruneBackups, readBackup, restoreBackup } from "./backup";
import { parseBackup } from "@/lib/domain/backup";
import { runDailyJobs } from "./jobs";
import { NOTIFICATION_PERMS, listNotifications } from "./notifications";
import { todayIso } from "./time";
import { addDays } from "@/lib/domain/dates";

type Gym = Awaited<ReturnType<typeof makeGym>>;
type User = Awaited<ReturnType<Gym["user"]>>;

const file = (text: string, name = "backup.json") => new File([text], name, { type: "application/json" });

describe.skipIf(!hasDb)("backups (database)", () => {
  let gym: Gym;
  let other: Gym;
  let admin: User;
  let otherAdmin: User;
  let dir: string;
  let memberId: string;
  let otherMemberId: string;
  let backupA: Awaited<ReturnType<typeof createBackup>>;
  let textA: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "fitron-backups-"));
    vi.stubEnv("STORAGE_DIR", dir);
    vi.stubEnv("S3_BUCKET", "");
    gym = await makeGym();
    other = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    otherAdmin = pick(await other.user("Super Admin"), other.a.id);
    const planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: true, features: [] })).id;
    memberId = (await createMember(admin, { name: "Backup Member", gender: "Male", phone: "9822200001", source: "Walk-in", tags: [] })).id;
    await sellMembership(admin, memberId, { planId, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "UPI" });
    otherMemberId = (await createMember(otherAdmin, { name: "Other Gym Member", gender: "Female", phone: "9822200002", source: "Walk-in", tags: [] })).id;
    await putSetting(admin, "gym", { name: "Original Name" });
  });

  it("creates a manual backup holding only this gym, without password hashes, and audits it", async () => {
    backupA = await createBackup(admin, "MANUAL");
    expect(backupA.kind).toBe("MANUAL");
    expect(backupA.counts).toMatchObject({ members: 1, invoices: 1, payments: 1 });
    expect(backupA.size).toBeGreaterThan(0);
    expect(backupA.fileName).toMatch(/^fitron-backup-test-gym-[a-z0-9]+-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const stored = path.join(dir, backupA.storageKey);
    expect(existsSync(stored)).toBe(true);
    const r = await readBackup(admin, backupA.id);
    textA = Buffer.from(r!.body).toString("utf8");
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(r!.body).digest("hex")).toBe(backupA.sha256);
    const parsed = parseBackup(textA)!;
    expect(parsed).not.toBeNull();
    expect(parsed.org.id).toBe(gym.org.id);
    expect(parsed.tables.Member.map((m) => m.id)).toEqual([memberId]);
    expect(parsed.tables.Member.map((m) => m.id)).not.toContain(otherMemberId);
    expect(parsed.tables.Branch.map((b) => b.id).sort()).toEqual([gym.a.id, gym.b.id].sort());
    expect(parsed.tables.User.length).toBeGreaterThan(0);
    for (const u of parsed.tables.User) {
      expect(u.roleName).toBeTruthy();
      expect("passwordHash" in u).toBe(false);
    }
    expect(parsed.tables.AuditLog.length).toBeGreaterThan(0);
    const audits = await db.auditLog.findMany({ where: { orgId: gym.org.id, entity: "Backup", action: "backup.create" } });
    expect(audits.some((a) => a.entityId === backupA.id)).toBe(true);
  });

  it("downloads only for the owning gym, records the download, and reports status", async () => {
    expect(await readBackup(otherAdmin, backupA.id)).toBeNull();
    const r = await readBackup(admin, backupA.id);
    expect(Buffer.from(r!.body).toString("utf8")).toBe(textA);
    expect((await db.backup.findUniqueOrThrow({ where: { id: backupA.id } })).downloadedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "backup.download", entityId: backupA.id } })).toBeGreaterThan(0);
    const s = await backupStatus(gym.org.id);
    expect(s.lastManualAt).not.toBeNull();
    expect(s.lastManualBy).toBe(admin.name);
    expect(s.lastDownloadedAt).not.toBeNull();
    expect(s.lastAutoAt).toBeNull();
    expect(s.files).toBe(1);
    expect(s.bytes).toBe(backupA.size);
    expect(s.counts).toMatchObject({ members: 1, invoices: 1, payments: 1 });
    const list = await listBackups(gym.org.id);
    expect(list.map((b) => b.id)).toEqual([backupA.id]);
    expect(list[0]!.createdBy).toBe(admin.name);
  });

  it("refuses a restore without changing anything", async () => {
    const admin2 = pick(await gym.user("Admin"), gym.a.id);
    const before = await db.member.count({ where: { orgId: gym.org.id } });
    await expect(restoreBackup(admin2, { backupId: backupA.id }, "RESTORE")).rejects.toThrow(/Super Admin/);
    await expect(restoreBackup(admin, { backupId: backupA.id }, "nope")).rejects.toThrow(/Type RESTORE/);
    await expect(restoreBackup(admin, { file: file("hello", "notes.txt") }, "RESTORE")).rejects.toThrow(/not a Fitron backup/);
    await expect(restoreBackup(admin, { file: file("") }, "RESTORE")).rejects.toThrow(/Choose a backup file/);
    const parsed = JSON.parse(textA);
    await expect(restoreBackup(admin, { file: file(JSON.stringify({ ...parsed, org: { ...parsed.org, id: other.org.id } })) }, "RESTORE")).rejects.toThrow(/different gym/);
    await expect(restoreBackup(admin, { file: file(JSON.stringify({ ...parsed, format: 99 })) }, "RESTORE")).rejects.toThrow(/newer version/);
    const withoutMe = { ...parsed, tables: { ...parsed.tables, User: parsed.tables.User.filter((u: { id: string }) => u.id !== admin.id) } };
    await expect(restoreBackup(admin, { file: file(JSON.stringify(withoutMe)) }, "RESTORE")).rejects.toThrow(/lock you out/);
    const badRole = { ...parsed, tables: { ...parsed.tables, User: parsed.tables.User.map((u: { id: string }) => ({ ...u, roleName: "Janitor" })) } };
    await expect(restoreBackup(admin, { file: file(JSON.stringify(badRole)) }, "RESTORE")).rejects.toThrow(/role this server doesn't know: Janitor/);
    const dangling = { ...parsed, tables: { ...parsed.tables, Payment: parsed.tables.Payment.map((p: { invoiceId: string }) => ({ ...p, invoiceId: "nope" })) } };
    await expect(restoreBackup(admin, { file: file(JSON.stringify(dangling)) }, "RESTORE")).rejects.toThrow(/inconsistent/);
    // Another gym's Super Admin cannot restore our file into their gym, nor reach our server backup.
    await expect(restoreBackup(otherAdmin, { file: file(textA) }, "RESTORE")).rejects.toThrow(/different gym/);
    await expect(restoreBackup(otherAdmin, { backupId: backupA.id }, "RESTORE")).rejects.toThrow(/not found/);
    expect(await db.member.count({ where: { orgId: gym.org.id } })).toBe(before);
    expect(await db.backup.count({ where: { orgId: gym.org.id, kind: "PRE_RESTORE" } })).toBe(0);
    expect(await db.member.count({ where: { orgId: other.org.id } })).toBe(1);
  });

  it("restores a server backup in one go, keeping staff, audit history and a safety copy", async () => {
    const later = await createMember(admin, { name: "Later Member", gender: "Female", phone: "9822200003", source: "Walk-in", tags: [] });
    const newStaff = await gym.user("Receptionist");
    await putSetting(admin, "gym", { name: "Changed Name" });
    const seqBefore = JSON.parse(textA).tables.Sequence;
    expect(await db.member.count({ where: { orgId: gym.org.id, deletedAt: null, walkIn: false } })).toBe(2);
    const auditBefore = await db.auditLog.count({ where: { orgId: gym.org.id, action: { in: ["member.create", "payment.create", "payment.collect"] } } });
    expect(auditBefore).toBeGreaterThan(0);

    const r = await restoreBackup(admin, { backupId: backupA.id }, "RESTORE");
    expect(r.safetyBackupId).toBeTruthy();
    expect(r.counts).toMatchObject({ members: 1 });

    expect(await db.member.count({ where: { orgId: gym.org.id, deletedAt: null, walkIn: false } })).toBe(1);
    expect(await db.member.findUnique({ where: { id: later.id } })).toBeNull();
    expect(await db.member.findUnique({ where: { id: memberId } })).not.toBeNull();
    expect((await getSetting<{ name: string }>(gym.org.id, "gym"))?.name).toBe("Original Name");
    const seqNow = await db.sequence.findMany({ where: { orgId: gym.org.id }, orderBy: { name: "asc" } });
    expect(seqNow.map((s) => [s.name, s.next])).toEqual(seqBefore.map((s: { name: string; next: number }) => [s.name, s.next]));
    expect(await db.invoice.count({ where: { orgId: gym.org.id } })).toBe(1);
    expect(await db.payment.count({ where: { orgId: gym.org.id } })).toBe(1);
    expect(await db.membership.count({ where: { branch: { orgId: gym.org.id } } })).toBe(1);

    const row = await db.backup.findUniqueOrThrow({ where: { id: backupA.id } });
    expect(row.restoredAt).not.toBeNull();
    expect(row.restoredById).toBe(admin.id);
    const safety = await db.backup.findFirst({ where: { orgId: gym.org.id, kind: "PRE_RESTORE" } });
    expect(safety?.id).toBe(r.safetyBackupId);
    expect(safety?.counts).toMatchObject({ members: 2 });
    expect(existsSync(path.join(dir, safety!.storageKey))).toBe(true);

    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: { in: ["member.create", "payment.create", "payment.collect"] } } })).toBe(auditBefore);
    const restoreAudit = await db.auditLog.findFirst({ where: { orgId: gym.org.id, action: "backup.restore" }, orderBy: { id: "desc" } });
    expect(restoreAudit?.entityId).toBe(backupA.id);
    expect(restoreAudit?.before).toMatchObject({ counts: { members: 2 } });
    expect(restoreAudit?.after).toMatchObject({ counts: { members: 1 }, safetyBackupId: r.safetyBackupId });

    const me = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(me.active).toBe(true);
    expect(me.deletedAt).toBeNull();
    expect(me.passwordHash).toBe("x");
    const gone = await db.user.findUniqueOrThrow({ where: { id: newStaff.id } });
    expect(gone.active).toBe(false);
    expect(gone.deletedAt).not.toBeNull();
  });

  it("restores an uploaded file the same way and audits it as a file", async () => {
    await createMember(admin, { name: "Another Later Member", gender: "Male", phone: "9822200004", source: "Walk-in", tags: [] });
    expect(await db.member.count({ where: { orgId: gym.org.id, deletedAt: null, walkIn: false } })).toBe(2);
    const r = await restoreBackup(admin, { file: file(textA, "fitron-backup.json") }, "RESTORE");
    expect(await db.member.count({ where: { orgId: gym.org.id, deletedAt: null, walkIn: false } })).toBe(1);
    const a = await db.auditLog.findFirst({ where: { orgId: gym.org.id, action: "backup.restore" }, orderBy: { id: "desc" } });
    expect(a?.entityId).toBe("file");
    expect(a?.after).toMatchObject({ fileName: "fitron-backup.json", safetyBackupId: r.safetyBackupId });
    expect(await db.backup.count({ where: { orgId: gym.org.id, kind: "PRE_RESTORE" } })).toBe(2);
    expect(await db.member.count({ where: { orgId: other.org.id } })).toBe(1);
  });

  it("runs the automatic backup once a day, prunes old ones and nudges weekly", async () => {
    const today = todayIso();
    const fresh = await makeGym();
    const owner = pick(await fresh.user("Super Admin"), fresh.a.id);
    const desk = pick(await fresh.user("Receptionist"), fresh.a.id);
    await createMember(owner, { name: "Nudge Member", gender: "Male", phone: "9822200005", source: "Walk-in", tags: [] });

    const first = await runDailyJobs(fresh.org.id, today);
    expect(first.find((j) => j.name === "backup.auto")).toMatchObject({ status: "ran", result: { pruned: 0 } });
    expect(first.find((j) => j.name === "backup.nudge")).toMatchObject({ status: "ran", result: { notified: 1 } });
    expect(await db.backup.count({ where: { orgId: fresh.org.id, kind: "AUTO" } })).toBe(1);
    const second = await runDailyJobs(fresh.org.id, today);
    expect(second.find((j) => j.name === "backup.auto")?.status).toBe("skipped");
    expect(await db.backup.count({ where: { orgId: fresh.org.id, kind: "AUTO" } })).toBe(1);

    const due = (await listNotifications(owner)).filter((n) => n.type === "BACKUP_DUE");
    expect(due.map((n) => n.text)).toEqual(["No backup has been downloaded yet. Do it once a week from Settings › Backup."]);
    expect(due[0]!.link).toBe("/settings/backup");
    expect((await listNotifications(desk)).filter((n) => n.type === "BACKUP_DUE")).toHaveLength(0);
    expect(NOTIFICATION_PERMS.BACKUP_DUE).toBe("settings.manage");

    // The next day: nothing new while the reminder is under a week old.
    const next = await runDailyJobs(fresh.org.id, addDays(today, 1));
    expect(next.find((j) => j.name === "backup.nudge")).toMatchObject({ status: "ran", result: { notified: 0 } });
    expect(await db.notification.count({ where: { orgId: fresh.org.id, type: "BACKUP_DUE" } })).toBe(1);

    // A manual backup today means no nudge at all for a gym.
    const quiet = await makeGym();
    const quietOwner = pick(await quiet.user("Super Admin"), quiet.a.id);
    await createMember(quietOwner, { name: "Quiet Member", gender: "Male", phone: "9822200006", source: "Walk-in", tags: [] });
    await createBackup(quietOwner, "MANUAL");
    await runDailyJobs(quiet.org.id, today);
    expect(await db.notification.count({ where: { orgId: quiet.org.id, type: "BACKUP_DUE" } })).toBe(0);
    // An 8-day-old manual backup is nudged with its age.
    await db.backup.updateMany({ where: { orgId: quiet.org.id, kind: "MANUAL" }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    const aged = await runDailyJobs(quiet.org.id, addDays(today, 1));
    expect(aged.find((j) => j.name === "backup.nudge")?.result).toMatchObject({ notified: 1 });
    expect((await db.notification.findFirst({ where: { orgId: quiet.org.id, type: "BACKUP_DUE" } }))?.text).toBe("Last manual backup was 8 days ago. Download one from Settings › Backup.");

    // Pruning: an old automatic backup goes (file too); the newest automatic one and a restored one stay.
    const oldAuto = await createBackup({ orgId: fresh.org.id, userId: null }, "AUTO", new Date(Date.now() - 31 * 86_400_000));
    const olderAuto = await createBackup({ orgId: fresh.org.id, userId: null }, "AUTO", new Date(Date.now() - 40 * 86_400_000));
    await db.backup.update({ where: { id: olderAuto.id }, data: { restoredAt: new Date() } });
    const oldManual = await createBackup(owner, "MANUAL", new Date(Date.now() - 40 * 86_400_000));
    expect(existsSync(path.join(dir, oldAuto.storageKey))).toBe(true);
    expect(await pruneBackups(fresh.org.id)).toBe(1);
    const left = (await db.backup.findMany({ where: { orgId: fresh.org.id } })).map((b) => b.id);
    expect(left).not.toContain(oldAuto.id);
    expect(left).toContain(olderAuto.id);
    expect(left).toContain(oldManual.id);
    expect(existsSync(path.join(dir, oldAuto.storageKey))).toBe(false);
    const prune = await db.auditLog.findFirst({ where: { orgId: fresh.org.id, action: "backup.prune" } });
    expect(prune?.actorType).toBe("SYSTEM");
    expect(prune?.after).toMatchObject({ removed: [{ id: oldAuto.id }] });
    expect(await backupNudge(fresh.org.id)).toMatchObject({ notified: 0 });
  });
});
