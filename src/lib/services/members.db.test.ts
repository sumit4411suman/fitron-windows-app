import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getObject } from "@/lib/integrations/storage";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember, deleteMember, getMember, readMemberPhoto, removeMemberPhoto, setMemberPhoto, listDeleted, listMembers, restoreMember, summarize, updateMember } from "./members";
import { collectPayment, sellMembership } from "./billing";
import { fromIso, todayIso } from "./time";
import { createPlan, deletePlan } from "./plans";
import { UserError } from "./errors";
import type { MemberInput } from "@/lib/validation/member";

const input = (over: Partial<MemberInput> = {}): MemberInput => ({
  name: "Priya Sharma",
  gender: "Female",
  phone: "9876500001",
  source: "Walk-in",
  tags: [],
  ...over,
});

describe.skipIf(!hasDb)("members (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  beforeAll(async () => {
    vi.stubEnv("STORAGE_DIR", mkdtempSync(path.join(tmpdir(), "fitron-members-")));
    vi.stubEnv("S3_BUCKET", "");
    gym = await makeGym();
  });

  it("numbers members without gaps and audits the create", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m1 = await createMember(admin, input({ phone: "9876500011" }));
    const m2 = await createMember(admin, input({ phone: "9876500012" }));
    expect(Number(m2.code.split("-")[1])).toBe(Number(m1.code.split("-")[1]) + 1);
    const log = await db.auditLog.findFirst({ where: { entity: "Member", entityId: m1.id } });
    expect(log).toMatchObject({ action: "member.create", userId: admin.id });
  });

  it("rejects a duplicate phone among active members, and allows it after a delete", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, input({ phone: "9876500021" }));
    await expect(createMember(admin, input({ phone: "9876500021" }))).rejects.toThrow(UserError);
    await deleteMember(admin, m.id, "test cleanup");
    const again = await createMember(admin, input({ phone: "9876500021", name: "New Owner" }));
    expect(again.name).toBe("New Owner");
    expect(await getMember(admin, m.id)).toBeNull();
  });

  it("won't let an edit take another member's phone", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    await createMember(admin, input({ phone: "9876500031" }));
    const other = await createMember(admin, input({ phone: "9876500032" }));
    await expect(updateMember(admin, other.id, input({ phone: "9876500031" }))).rejects.toThrow(/already belongs/);
  });

  it("keeps branches apart", async () => {
    const admin = await gym.user("Super Admin");
    const inB = await createMember(pick(admin, gym.b.id), input({ phone: "9876500041" }));
    const frontDeskA = await gym.user("Receptionist", [gym.a.id]);
    expect(await getMember(frontDeskA, inB.id)).toBeNull();
    expect((await listMembers(frontDeskA, { all: true })).rows.some((r) => r.id === inB.id)).toBe(false);
  });

  it("shows trainers only their assigned members", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const trainer = await gym.user("Trainer", [gym.a.id]);
    const mine = await createMember(admin, input({ phone: "9876500051", trainerId: trainer.id }));
    const notMine = await createMember(admin, input({ phone: "9876500052" }));
    const seen = (await listMembers(trainer, { all: true })).rows.map((r) => r.id);
    expect(seen).toContain(mine.id);
    expect(seen).not.toContain(notMine.id);
  });

  it("shows a member with no membership as NO_PLAN, apart from the expired ones", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, input({ phone: "9876500061" }));
    expect((await getMember(admin, m.id))?.status).toBe("NO_PLAN");
    expect((await listMembers(admin, { status: "EXPIRED", all: true })).rows.map((r) => r.id)).not.toContain(m.id);
    const noPlan = await listMembers(admin, { status: "NO_PLAN", all: true });
    expect(noPlan.rows.map((r) => r.id)).toContain(m.id);
    expect(noPlan.counts.NO_PLAN).toBeGreaterThanOrEqual(1);
  });

  it("lets unsold plans be deleted", async () => {
    const admin = await gym.user("Super Admin");
    const p = await createPlan(admin, { name: "Trial", kind: "Membership", months: 1, price: 100, regFee: 0, discount: 0, gstApplicable: true, features: [] });
    await deletePlan(admin, p.id);
    expect(await db.membershipPlan.findUnique({ where: { id: p.id } })).toBeNull();
  });

  it("restores a deleted member unless their phone was taken meanwhile", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, input({ phone: "9876500091", name: "Comes Back" }));
    await deleteMember(admin, m.id, "test cleanup");
    expect((await listDeleted(admin)).find((d) => d.id === m.id)?.deletedBy).toBe(admin.name);
    await restoreMember(admin, m.id);
    expect(await getMember(admin, m.id)).not.toBeNull();

    await deleteMember(admin, m.id, "test cleanup");
    await createMember(admin, input({ phone: "9876500091", name: "New Number Owner" }));
    await expect(restoreMember(admin, m.id)).rejects.toThrow(/now belongs to New Number Owner/);
  });

  it("filters by area, balance due and risk, sorted by name", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    await createMember(admin, input({ phone: "9876500101", name: "Zoya Area", area: "Sector 4" }));
    const risky = await createMember(admin, input({ phone: "9876500102", name: "Aarav Risky", area: "Sector 4" }));
    await db.member.update({ where: { id: risky.id }, data: { riskScore: 70 } });
    expect((await listMembers(admin, { area: "Sector 4" })).rows.map((r) => r.name)).toEqual(["Aarav Risky", "Zoya Area"]);
    expect((await listMembers(admin, { status: "RISK" })).rows.map((r) => r.name)).toContain("Aarav Risky");
    expect((await listMembers(admin, { status: "DUE" })).rows.every((r) => r.outstanding > 0)).toBe(true);
    expect((await listMembers(admin, { pageSize: 2 })).rows).toHaveLength(2);
  });

  it("reports the start of the membership the plan name comes from", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const bare = await createMember(admin, input({ phone: "9876500071" }));
    const sold = await createMember(admin, input({ phone: "9876500072" }));
    const p = await createPlan(admin, { name: "Starter", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const today = todayIso();
    await sellMembership(admin, sold.id, { planId: p.id, startDate: today, discount: 0, includeRegFee: false, payAmount: 0 });
    const sums = await summarize([bare.id, sold.id], today);
    expect(sums.get(sold.id)).toMatchObject({ planName: "Starter", planStart: today });
    expect(sums.get(bare.id)).toMatchObject({ planName: null, planStart: null });
  });

  it("lists an erased member as deleted with the erasure date", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, input({ name: "Erased Devi", phone: "9876500099" }));
    const erasedAt = new Date();
    await db.member.update({ where: { id: m.id }, data: { name: "Erased member", phone: "", deletedAt: erasedAt, erasedAt } });
    const row = (await listDeleted(admin)).find((d) => d.id === m.id);
    expect(row?.erasedAt?.getTime()).toBe(erasedAt.getTime());
    expect(row?.name).toBe("Erased member");
    await expect(restoreMember(admin, m.id)).rejects.toThrow(/can't be restored/);
  });

  it("needs a reason, records who and why, and restore clears it", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, input({ phone: "9876500201" }));
    await expect(deleteMember(admin, m.id, " ab")).rejects.toThrow(/reason/);
    expect(await getMember(admin, m.id)).not.toBeNull();
    await deleteMember(admin, m.id, "Moved city");
    const row = await db.member.findUniqueOrThrow({ where: { id: m.id } });
    expect(row).toMatchObject({ deletedById: admin.id, deleteReason: "Moved city" });
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: m.id, action: "member.delete" } });
    expect((log.after as { deleteReason: string }).deleteReason).toBe("Moved city");
    expect((await listDeleted(admin)).find((d) => d.id === m.id)).toMatchObject({ deletedBy: admin.name, deleteReason: "Moved city" });
    await restoreMember(admin, m.id);
    expect(await db.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ deletedAt: null, deletedById: null, deleteReason: null });
  });

  it("won't delete a member who still owes money", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, input({ phone: "9876500202" }));
    const p = await createPlan(admin, { name: "Owed", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const sold = await sellMembership(admin, m.id, { planId: p.id, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 0 });
    await expect(deleteMember(admin, m.id, "Moved city")).rejects.toThrow(/still owes/);
    await collectPayment(admin, sold.invoice.id, { amount: 100000, method: "Cash", date: todayIso() } as never);
    await deleteMember(admin, m.id, "Moved city");
    expect(await getMember(admin, m.id)).toBeNull();
  });

  it("cancels autopay and closes an open check-in on delete", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, input({ phone: "9876500203" }));
    const p = await createPlan(admin, { name: "Auto", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const mandate = await db.autopayMandate.create({ data: { code: `MAN-${Date.now()}`, orgId: gym.org.id, branchId: gym.a.id, memberId: m.id, planId: p.id, amount: 100000, months: 1, mode: "demo", status: "Active", createdById: admin.id } });
    const visit = await db.attendance.create({ data: { branchId: gym.a.id, memberId: m.id, type: "MEMBER", date: fromIso(todayIso()), checkIn: new Date(), method: "Manual", createdById: admin.id } });
    await deleteMember(admin, m.id, "Moved city");
    expect((await db.autopayMandate.findUniqueOrThrow({ where: { id: mandate.id } })).status).toBe("Cancelled");
    expect((await db.attendance.findUniqueOrThrow({ where: { id: visit.id } })).checkOut).not.toBeNull();
    expect(await db.auditLog.count({ where: { entityId: mandate.id, action: "mandate.cancel" } })).toBe(1);
  });

  it("stores a member photo privately, replaces and removes it", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, input({ phone: "9876500204" }));
    const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], "me.png", { type: "image/png" });
    await expect(setMemberPhoto(admin, m.id, new File(["%PDF-1.4"], "x.pdf"))).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(setMemberPhoto(admin, m.id, new File([], "e.png"))).rejects.toThrow(/Choose a photo/);
    await setMemberPhoto(admin, m.id, png());
    const first = (await db.member.findUniqueOrThrow({ where: { id: m.id } })).photoKey!;
    expect(first).toContain(`/members/${m.id}/photo/`);
    await setMemberPhoto(admin, m.id, png());
    const second = (await db.member.findUniqueOrThrow({ where: { id: m.id } })).photoKey!;
    expect(second).not.toBe(first);
    await expect(getObject(first)).rejects.toThrow();
    await updateMember(admin, m.id, input({ phone: "9876500204", name: "Renamed" }));
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).photoKey).toBe(second);

    const desk = pick(await gym.user("Receptionist"), gym.a.id);
    expect((await readMemberPhoto(desk, m.id))?.mime).toBe("image/png");
    expect(await readMemberPhoto(pick(await gym.user("Receptionist"), gym.b.id), m.id)).toBeNull();
    expect(await readMemberPhoto(await (await makeGym()).user("Super Admin"), m.id)).toBeNull();
    expect(await readMemberPhoto(pick(await gym.user("Trainer"), gym.a.id), m.id)).toBeNull();

    await removeMemberPhoto(admin, m.id);
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).photoKey).toBeNull();
    await expect(getObject(second)).rejects.toThrow();
    const actions = (await db.auditLog.findMany({ where: { entityId: m.id } })).map((a) => a.action);
    expect(actions.filter((a) => a === "member.photo")).toHaveLength(2);
    expect(actions).toContain("member.photo.remove");
  });
});
