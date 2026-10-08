import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createInvoice } from "./billing";
import { branchRecordCounts, deleteBranch, saveBranch, setBranchActive } from "./settings";
import { assertBranchWritable, branchStandings, confirmDemoPayment, startBranchPayment } from "./saas";
import { todayIso } from "./time";

const today = todayIso();
const values = (name: string, short: string, more = {}) => ({ name, short, address: "Main Road", phone: "9000000001", hours: "06:00 – 22:00", ...more });
let phone = 9822200000;
const member = (u: Parameters<typeof createMember>[0]) => createMember(u, { name: "Branch Test", gender: "Male", phone: String(phone++), source: "Walk-in", tags: [] });

describe.skipIf(!hasDb)("branches (database)", () => {
  beforeAll(() => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves the new fields, uppercases the prefix and keeps short names unique per gym", async () => {
    const g = await makeGym();
    const u = await g.user("Super Admin");
    await saveBranch(u, null, values("Chas", "Chas", { manager: "Rahul", invoicePrefix: "ch-", gstin: "20ABCDE1234F1Z5" }));
    const b = await db.branch.findFirstOrThrow({ where: { orgId: g.org.id, name: "Chas" } });
    expect(b).toMatchObject({ short: "Chas", hours: "06:00 – 22:00", manager: "Rahul", gstin: "20ABCDE1234F1Z5", active: true });
    expect(b.invoicePrefix).toBe("ch-"); // the form uppercases; the service stores what validation hands it
    await expect(saveBranch(u, null, values("Other", "CHAS"))).rejects.toThrow(/short name/);
    const g2 = await makeGym();
    await saveBranch(await g2.user("Super Admin"), null, values("Chas", "Chas"));
  });

  it("numbers invoices with the branch prefix and keeps one sequence", async () => {
    const g = await makeGym();
    const u = await g.user("Super Admin");
    await db.branch.update({ where: { id: g.a.id }, data: { invoicePrefix: "CH-" } });
    const line = [{ description: "PT", category: "Personal Training" as const, qty: 1, rate: 10000, discount: 0, taxable: false }];
    const inA = pick(u, g.a.id);
    const inB = pick(u, g.b.id);
    const ma = await member(inA);
    const mb = await member(inB);
    const x = await createInvoice(inA, { memberId: ma.id, date: today, dueDate: today, payAmount: 0, lines: line });
    const y = await createInvoice(inB, { memberId: mb.id, date: today, dueDate: today, payAmount: 0, lines: line });
    expect(x.number).toMatch(/^CH-\d+$/);
    expect(y.number).not.toMatch(/^CH-/);
    expect(Number(y.number.match(/(\d+)$/)![1])).toBeGreaterThan(Number(x.number.match(/(\d+)$/)![1]));
  });

  it("closes a branch without losing data, blocks new records, keeps one open, and reopens", async () => {
    const g = await makeGym();
    const u = await g.user("Super Admin");
    const m = await member(pick(u, g.a.id));
    await setBranchActive(u, g.a.id, false);
    const a = await db.branch.findUniqueOrThrow({ where: { id: g.a.id } });
    expect(a.active).toBe(false);
    expect(a.deactivatedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { orgId: g.org.id, action: "branch.deactivate", entityId: g.a.id } })).toBe(1);
    expect(await db.member.count({ where: { id: m.id } })).toBe(1);
    await expect(member(pick(u, g.a.id))).rejects.toThrow(/closed/);
    await db.$transaction((tx) => assertBranchWritable(tx, g.org.id, g.b.id));
    await expect(setBranchActive(u, g.b.id, false)).rejects.toThrow(/At least one branch must stay active/);
    await setBranchActive(u, g.a.id, true);
    expect(await db.auditLog.count({ where: { orgId: g.org.id, action: "branch.activate", entityId: g.a.id } })).toBe(1);
    await member(pick(u, g.a.id));
  });

  it("reports closed branches as CLOSED and frees their seat", async () => {
    const g = await makeGym();
    const u = await g.user("Super Admin");
    await saveBranch(u, null, values("C", "C"));
    await setBranchActive(u, g.a.id, false);
    const s = await branchStandings(g.org.id, today);
    expect(s.branches.find((b) => b.id === g.a.id)!.standing.kind).toBe("CLOSED");
    // Two open branches + one closed: a new one still fits in the included seats.
    await saveBranch(u, null, values("D", "D"));
    expect((await branchStandings(g.org.id, today)).branches.filter((b) => b.standing.kind === "INCLUDED")).toHaveLength(3);
  });

  it("needs a paid slot to reopen a branch past the included seats", async () => {
    const g = await makeGym();
    const u = await g.user("Super Admin");
    await saveBranch(u, null, values("C", "C"));
    await setBranchActive(u, g.a.id, false);
    await saveBranch(u, null, values("D", "D"));
    await expect(setBranchActive(u, g.a.id, true)).rejects.toThrow(/Buy an extra branch to reopen/);
    const c = await startBranchPayment(u, "MONTHLY", null);
    await confirmDemoPayment(u, c.id);
    await setBranchActive(u, g.a.id, true);
    expect((await db.branchSubscription.findUniqueOrThrow({ where: { id: c.id } })).branchId).toBe(g.a.id);
  });

  it("deletes only branches without records, frees the paid slot and audits the reason", async () => {
    const g = await makeGym();
    const u = await g.user("Super Admin");
    await member(pick(u, g.a.id));
    expect((await branchRecordCounts(g.org.id, [g.a.id])).get(g.a.id)!.members).toBe(1);
    await expect(deleteBranch(u, g.a.id, "Test")).rejects.toThrow(/has records/);
    expect(await db.branch.count({ where: { id: g.a.id } })).toBe(1);

    await db.userBranch.deleteMany({ where: { branchId: g.b.id, userId: { not: u.id } } });
    const sub = await db.branchSubscription.create({ data: { orgId: g.org.id, kind: "BRANCH", branchId: g.b.id, cycle: "YEARLY", base: 1, gst: 0, total: 1, status: "PAID", mode: "DEMO", createdById: u.id, periodStart: new Date(), periodEnd: new Date(Date.now() + 864e5 * 30) } });
    await deleteBranch(u, g.b.id, "Opened by mistake");
    expect(await db.branch.count({ where: { id: g.b.id } })).toBe(0);
    expect(await db.userBranch.count({ where: { branchId: g.b.id } })).toBe(0);
    expect((await db.branchSubscription.findUniqueOrThrow({ where: { id: sub.id } })).branchId).toBeNull();
    const log = await db.auditLog.findFirstOrThrow({ where: { orgId: g.org.id, action: "branch.delete", entityId: g.b.id } });
    expect(log.after).toMatchObject({ reason: "Opened by mistake" });
    await expect(deleteBranch(u, g.a.id, "Last one")).rejects.toThrow(/only branch/);
  });
});
