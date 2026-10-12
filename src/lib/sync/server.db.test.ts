import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { hasDb, makeGym, pick } from "@/test/db";
import { isLocal } from "@/lib/runtime/edition";
import { createMember } from "@/lib/services/members";
import { createPlan } from "@/lib/services/plans";
import { cancelInvoice, sellMembership } from "@/lib/services/billing";
import { readRecord } from "./records";
import { authDevice, changesSince, linkDevice, pushOne, registerGym, requireResync, revokeDevice, snapshotPage, type DeviceAuth } from "./server";
import type { PushItem } from "./protocol";
import type { WireRow } from "./codec";

// Cloud sync on fitron.in: every rule a computer's upload meets (SYNC.md §6–7), on the real database and triggers.

const PASSWORD = "Sync-test-password-1";
const changeId = () => randomUUID().replace(/-/g, "");

async function linkedGym() {
  const gym = await makeGym();
  const owner = pick(await gym.user("Super Admin"), gym.a.id);
  await db.user.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  const linked = await linkDevice({ email: owner.email, password: PASSWORD }, { name: "Front desk PC" });
  const dev = (await authDevice(`Bearer ${linked.token}`))!;
  const plan = await createPlan(owner, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
  return { gym, owner, linked, dev, plan };
}

const version = async (orgId: string, entity: string, entityId: string) => Number((await db.syncChange.aggregate({ where: { orgId, entity, entityId }, _max: { seq: true } }))._max.seq ?? 0);
const item = (entity: string, data: WireRow | null, entityId: string, baseVersion = 0): PushItem => ({ changeId: changeId(), entity, entityId, op: data ? "upsert" : "delete", data, baseVersion });

describe.skipIf(!hasDb || isLocal())("cloud sync on fitron.in (database)", () => {
  let g: Awaited<ReturnType<typeof linkedGym>>;
  let other: Awaited<ReturnType<typeof linkedGym>>;
  beforeAll(async () => {
    g = await linkedGym();
    other = await linkedGym();
  });

  it("links a computer with the owner's password only, and its token alone names the gym", async () => {
    expect(g.dev).toMatchObject({ orgId: g.gym.org.id, deviceNo: 1, name: "Front desk PC" });
    await expect(linkDevice({ email: g.owner.email, password: "wrong" }, { name: "x" })).rejects.toThrow("Email or password is incorrect.");
    const desk = await g.gym.user("Receptionist", [g.gym.a.id]);
    await db.user.update({ where: { id: desk.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    await expect(linkDevice({ email: desk.email, password: PASSWORD }, { name: "x" })).rejects.toThrow(/Only a Super Admin/);
    expect(await authDevice("Bearer fsd_" + "x".repeat(43))).toBeNull();
    expect(await authDevice(null)).toBeNull();
  });

  it("records every website change in the outbox, with the record's data and never a password", async () => {
    const m = await createMember(g.owner, { name: "Website Member", gender: "Male", phone: "9811000001", source: "Walk-in", tags: [] });
    const page = await changesSince(g.dev, 0);
    const c = page.changes.find((x) => x.entity === "Member" && x.entityId === m.id)!;
    expect(c).toMatchObject({ op: "upsert", origin: "cloud", data: { name: "Website Member", phone: "9811000001" } });
    const u = page.changes.find((x) => x.entity === "User" && x.entityId === g.owner.id);
    if (u) {
      expect(u.data).not.toHaveProperty("passwordHash");
      expect(u.data?.$role).toBe("Super Admin");
    }
    // Nothing of the other gym, ever.
    expect(page.changes.every((x) => x.data == null || x.data.orgId === undefined || x.data.orgId === g.gym.org.id)).toBe(true);
  });

  it("applies a computer's new member once, however often the upload is repeated", async () => {
    const template = (await readRecord(db, "Member", (await createMember(g.owner, { name: "Template", gender: "Female", phone: "9811000002", source: "Walk-in", tags: [] })).id))!;
    const id = `m_${changeId().slice(0, 20)}`;
    const data = { ...template, id, code: "FT-1000001", name: "Offline Member", phone: "9811000003" };
    const it1 = item("Member", data, id);
    const first = await pushOne(g.dev, it1);
    expect(first).toMatchObject({ status: "applied" });
    expect(first.version).toBe(await version(g.gym.org.id, "Member", id));
    const again = await pushOne(g.dev, it1);
    expect(again).toMatchObject({ status: "applied", replayed: true, version: first.version });
    expect(await db.member.count({ where: { id } })).toBe(1);
    const recorded = await db.syncChange.findFirst({ where: { entity: "Member", entityId: id }, orderBy: { seq: "desc" } });
    expect(recorded?.origin).toBe(`device:${g.dev.id}`);
  });

  it("one payment for a duplicate upload, and a payment that would take an invoice past its total is refused", async () => {
    const m = await createMember(g.owner, { name: "Pays Twice", gender: "Male", phone: "9811000004", source: "Walk-in", tags: [] });
    const sale = await sellMembership(g.owner, m.id, { planId: g.plan.id, startDate: "2026-10-01", discount: 0, includeRegFee: false, payAmount: 0 });
    const pay = (id: string, amount: number) => ({ id, code: `PAY-${id.slice(-6)}`, orgId: g.gym.org.id, branchId: sale.invoice.branchId, invoiceId: sale.invoice.id, memberId: m.id, date: "2026-10-05T00:00:00.000Z", amount, method: "Cash", txnRef: null, notes: null, status: "SUCCESS", receivedById: g.owner.id, reversedById: null, reversedAt: null, reverseReason: null, createdAt: "2026-10-05T05:00:00.000Z" });
    const one = `pay_${changeId().slice(0, 16)}`;
    const two = `pay_${changeId().slice(0, 16)}`;
    const p1 = item("Payment", pay(one, 100000), one);
    expect((await pushOne(g.dev, p1)).status).toBe("applied");
    expect((await pushOne(g.dev, p1)).replayed).toBe(true);
    expect(await db.payment.count({ where: { invoiceId: sale.invoice.id } })).toBe(1);
    const over = await pushOne(g.dev, item("Payment", pay(two, 60000), two));
    expect(over).toMatchObject({ status: "rejected", reason: expect.stringMatching(/past its total: ₹500\.00 was still due/) });
    expect(await db.payment.count({ where: { invoiceId: sale.invoice.id } })).toBe(1);
    // A recorded payment's amount never changes; reversing it does.
    const recorded = (await readRecord(db, "Payment", one))!;
    const base = await version(g.gym.org.id, "Payment", one);
    expect(await pushOne(g.dev, item("Payment", { ...recorded, amount: 1 }, one, base))).toMatchObject({ status: "rejected", reason: expect.stringMatching(/cannot be changed this way \(amount\)/) });
    const reversed = await pushOne(g.dev, item("Payment", { ...recorded, status: "REVERSED", reversedById: g.owner.id, reversedAt: "2026-10-06T05:00:00.000Z", reverseReason: "Entered twice" }, one, base));
    expect(reversed.status).toBe("applied");
    expect((await db.payment.findUniqueOrThrow({ where: { id: one } })).status).toBe("REVERSED");
  });

  it("refuses money dated in a month closed on fitron.in", async () => {
    const m = await createMember(g.owner, { name: "Closed Month", gender: "Male", phone: "9811000005", source: "Walk-in", tags: [] });
    const sale = await sellMembership(g.owner, m.id, { planId: g.plan.id, startDate: "2026-10-01", discount: 0, includeRegFee: false, payAmount: 0 });
    await db.monthLock.create({ data: { branchId: sale.invoice.branchId, month: "2026-08", lockedById: g.owner.id, lockedAt: new Date() } });
    const aug = `pay_${changeId().slice(0, 16)}`;
    const r = await pushOne(g.dev, item("Payment", { id: aug, code: `PAY-${aug.slice(-6)}`, orgId: g.gym.org.id, branchId: sale.invoice.branchId, invoiceId: sale.invoice.id, memberId: m.id, date: "2026-08-20T00:00:00.000Z", amount: 1000, method: "Cash", txnRef: null, notes: null, status: "SUCCESS", receivedById: g.owner.id, reversedById: null, reversedAt: null, reverseReason: null, createdAt: "2026-08-20T05:00:00.000Z" }, aug));
    expect(r).toMatchObject({ status: "rejected", reason: expect.stringMatching(/2026-08 is closed on fitron\.in/) });
  });

  it("never touches another gym's records, and says so in the audit log", async () => {
    const theirs = await createMember(other.owner, { name: "Other Gym Member", gender: "Male", phone: "9811000006", source: "Walk-in", tags: [] });
    const wire = (await readRecord(db, "Member", theirs.id))!;
    const r = await pushOne(g.dev, item("Member", { ...wire, name: "Hijacked" }, theirs.id));
    expect(r).toMatchObject({ status: "rejected", reason: "This record does not belong to this gym." });
    expect((await db.member.findUniqueOrThrow({ where: { id: theirs.id } })).name).toBe("Other Gym Member");
    // A new record naming the other gym is refused too.
    const id = `m_${changeId().slice(0, 20)}`;
    expect((await pushOne(g.dev, item("Member", { ...wire, id, code: "X-1", phone: "9811000007" }, id))).status).toBe("rejected");
    expect(await db.member.count({ where: { id } })).toBe(0);
    const audit = await db.auditLog.findFirst({ where: { orgId: g.gym.org.id, action: "sync.refused_foreign", entityId: theirs.id } });
    expect(audit).toBeTruthy();
  });

  it("merges fields changed on different sides, and keeps both versions when the same field changed", async () => {
    const m = await createMember(g.owner, { name: "Merge Me", gender: "Male", phone: "9811000008", source: "Walk-in", tags: [] });
    const base = await version(g.gym.org.id, "Member", m.id);
    const seen = (await readRecord(db, "Member", m.id))!;
    await db.member.update({ where: { id: m.id }, data: { phone: "9811000009" } }); // the website, meanwhile
    const merged = await pushOne(g.dev, item("Member", { ...seen, name: "Merged Name" }, m.id, base));
    expect(merged).toMatchObject({ status: "applied", current: { name: "Merged Name", phone: "9811000009" } });
    expect(merged.conflict).toBeUndefined();
    const base2 = merged.version!;
    const seen2 = (await readRecord(db, "Member", m.id))!;
    await db.member.update({ where: { id: m.id }, data: { email: "web@x.in" } });
    const both = await pushOne(g.dev, item("Member", { ...seen2, email: "pc@x.in" }, m.id, base2));
    expect(both).toMatchObject({ status: "applied", conflict: { kind: "merged", fields: ["email"] } });
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).email).toBe("pc@x.in");
    const kept = await db.syncConflict.findFirst({ where: { entity: "Member", entityId: m.id } });
    expect(kept).toMatchObject({ kind: "merged", fields: "email" });
    expect((kept!.theirs as WireRow).email).toBe("web@x.in");
  });

  it("keeps the website's invoice when it changed first, and sends it back", async () => {
    const m = await createMember(g.owner, { name: "Cancel First", gender: "Male", phone: "9811000010", source: "Walk-in", tags: [] });
    const sale = await sellMembership(g.owner, m.id, { planId: g.plan.id, startDate: "2026-10-01", discount: 0, includeRegFee: false, payAmount: 0 });
    const base = await version(g.gym.org.id, "Invoice", sale.invoice.id);
    const seen = (await readRecord(db, "Invoice", sale.invoice.id))!;
    await cancelInvoice(g.owner, sale.invoice.id, "Sold by mistake");
    const r = await pushOne(g.dev, item("Invoice", { ...seen, pdfKey: "x" }, sale.invoice.id, base));
    expect(r).toMatchObject({ status: "conflict", conflict: { kind: "kept-website" }, current: { status: "CANCELLED" } });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: sale.invoice.id } })).pdfKey).toBeNull();
  });

  it("a deleted record does not come back from an edit made elsewhere", async () => {
    const lead = await db.lead.create({ data: { orgId: g.gym.org.id, branchId: g.gym.a.id, name: "Gone Lead", phone: "9811000011", source: "Walk-in", interest: "Membership", ownerId: g.owner.id } });
    const base = await version(g.gym.org.id, "Lead", lead.id);
    const seen = (await readRecord(db, "Lead", lead.id))!;
    await db.lead.delete({ where: { id: lead.id } });
    const r = await pushOne(g.dev, item("Lead", { ...seen, name: "Edited Offline" }, lead.id, base));
    expect(r).toMatchObject({ status: "conflict", conflict: { kind: "deleted" } });
    expect(await db.lead.count({ where: { id: lead.id } })).toBe(0);
    const del = (await changesSince(g.dev, base)).changes.find((c) => c.entityId === lead.id && c.op === "delete");
    expect(del).toBeTruthy();
  });

  it("does not record a change as applied when the server's own transaction fails", async () => {
    const id = `m_${changeId().slice(0, 20)}`;
    const template = (await readRecord(db, "Member", (await db.member.findFirstOrThrow({ where: { orgId: g.gym.org.id } })).id))!;
    const it1 = item("Member", { ...template, id, code: "FT-FAIL", phone: "9811000012" }, id);
    const spy = vi.spyOn(db, "$transaction").mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    await expect(pushOne(g.dev, it1)).rejects.toThrow("Connection terminated");
    spy.mockRestore();
    expect(await db.syncApplied.count({ where: { changeId: it1.changeId } })).toBe(0);
    expect(await db.member.count({ where: { id } })).toBe(0);
    // The computer keeps it and tries again: then it goes through, once.
    expect((await pushOne(g.dev, it1)).status).toBe("applied");
  });

  it("pages the whole gym with each record's version, and tells computers to download again after a restore", async () => {
    const first = await snapshotPage(g.dev, "Member", null, 2);
    expect(first.rows).toHaveLength(2);
    expect(first.last).toBeTruthy();
    const second = await snapshotPage(g.dev, "Member", first.last, 2);
    expect(second.rows[0]!.data.id).not.toBe(first.rows[0]!.data.id);
    expect(first.rows.every((r) => r.version > 0)).toBe(true);
    await db.$transaction((tx) => requireResync(tx, g.gym.org.id));
    const dev = (await authDevice(`Bearer ${g.linked.token}`))!;
    expect((await changesSince(dev, 0, 1)).resync).toBe(true);
    expect((await changesSince(dev, 0, 1, new Date())).resync).toBe(false);
  });

  it("an unlinked computer is refused from its next request", async () => {
    const extra = await linkDevice({ email: g.owner.email, password: PASSWORD }, { name: "Second PC" });
    expect(extra.device.no).toBe(2);
    await revokeDevice(g.gym.org.id, g.owner.id, extra.device.id);
    expect(await authDevice(`Bearer ${extra.token}`)).toBeNull();
  });

  it("puts a gym from a computer on fitron.in with the computer's own ids, once", async () => {
    const orgId = `org_${changeId().slice(0, 16)}`;
    const ownerId = `usr_${changeId().slice(0, 16)}`;
    const email = `owner-${changeId().slice(0, 8)}@example.in`;
    const send = vi.fn(async () => {});
    const r = await registerGym({ email, password: PASSWORD, name: "PC Owner", phone: "9811000013", gymName: "Desk Gym", orgId, ownerId, deviceName: "Desk", sequences: [{ name: "invoice", next: 1042 }] }, send, false);
    expect(r).toMatchObject({ org: { id: orgId }, user: { id: ownerId }, device: { no: 1 } });
    expect(await db.sequence.findUnique({ where: { orgId_name: { orgId, name: "invoice" } } })).toMatchObject({ next: 1042 });
    const dev = (await authDevice(`Bearer ${r.token}`)) as DeviceAuth;
    expect(dev.orgId).toBe(orgId);
    // The owner's record, uploaded by the computer as created there, is no conflict: the account was made from it.
    const owner = (await readRecord(db, "User", ownerId))!;
    expect((await pushOne(dev, item("User", { ...owner, phone: "9811000014" }, ownerId, 0))).status).toBe("applied");
    await expect(registerGym({ email, password: PASSWORD, name: "Again", phone: "1", gymName: "Again", orgId: `org_${changeId().slice(0, 16)}`, ownerId: `usr_${changeId().slice(0, 16)}`, deviceName: "x", sequences: [] }, send, false)).rejects.toThrow(/already a fitron\.in account/);
  });
});
