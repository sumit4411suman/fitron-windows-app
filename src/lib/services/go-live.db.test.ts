import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { getIdleMinutes, putSetting } from "./settings";
import { clearDemoData, goLiveChecklist } from "./go-live";
import { isDeviceOnline } from "./biometric";
import { todayIso } from "./time";

type Gym = Awaited<ReturnType<typeof makeGym>>;
type User = Awaited<ReturnType<Gym["user"]>>;

const item = (list: Awaited<ReturnType<typeof goLiveChecklist>>, key: string) => list.items.find((i) => i.key === key)!;

describe.skipIf(!hasDb)("go live (database)", () => {
  let gym: Gym;
  let other: Gym;
  let admin: User;
  let otherAdmin: User;

  beforeAll(async () => {
    gym = await makeGym();
    other = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    otherAdmin = pick(await other.user("Super Admin"), other.a.id);
  });

  it("refuses to clear a gym that is not the demo seed", async () => {
    const m = await createMember(admin, { name: "Kept Member", gender: "Male", phone: "9822300001", source: "Walk-in", tags: [] });
    await expect(clearDemoData(admin)).rejects.toThrow(/nothing to clear/);
    expect(await db.member.findUnique({ where: { id: m.id } })).not.toBeNull();
    await db.member.delete({ where: { id: m.id } });
  });

  it("checklist reads real state", async () => {
    let list = await goLiveChecklist(admin);
    expect(list.items).toHaveLength(13);
    expect(item(list, "plans")).toMatchObject({ ok: false, detail: "0 active plans" });
    expect(item(list, "staff")).toMatchObject({ ok: false, detail: "0 staff with roles and passwords" });
    expect(item(list, "demo").ok).toBe(true);
    expect(item(list, "idle").detail).toBe("Signs staff out after 30 minutes idle");
    expect(item(list, "privacy").ok).toBe(false);

    await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: true, features: [] });
    await gym.user("Receptionist");
    await putSetting(admin, "security", { idleMinutes: 0 });
    await putSetting(admin, "privacy", { officer: "Asha Rao", email: "privacy@gym.in" });
    await db.organization.update({ where: { id: gym.org.id }, data: { demo: true } });
    list = await goLiveChecklist(admin);
    expect(item(list, "plans")).toMatchObject({ ok: true, detail: "1 active plan" });
    expect(item(list, "staff")).toMatchObject({ ok: true, detail: "1 staff with roles and passwords" });
    expect(item(list, "idle")).toMatchObject({ ok: false, detail: "Idle sign-out is off" });
    expect(item(list, "privacy")).toMatchObject({ ok: true, detail: "Grievance officer: Asha Rao" });
    expect(item(list, "demo").ok).toBe(false);
    expect(item(list, "demo").button?.label).toBe("Clear demo data");
    await db.organization.update({ where: { id: gym.org.id }, data: { demo: false } });
  });

  it("security setting round-trips and is audited", async () => {
    expect(await getIdleMinutes(other.org.id)).toBe(30);
    await putSetting(admin, "security", { idleMinutes: 45 });
    expect(await getIdleMinutes(gym.org.id)).toBe(45);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "setting.update", entityId: "security" } })).toBeGreaterThan(0);
  });

  it("device online rule", () => {
    expect(isDeviceOnline({ lastSeenAt: new Date() })).toBe(true);
    expect(isDeviceOnline({ lastSeenAt: new Date(Date.now() - 6 * 60_000) })).toBe(false);
    expect(isDeviceOnline({ lastSeenAt: null })).toBe(false);
  });

  it("clears every demo record of the demo gym and nothing else", async () => {
    const orgId = gym.org.id;
    await db.organization.update({ where: { id: orgId }, data: { demo: true } });
    const planId = (await db.membershipPlan.findFirstOrThrow({ where: { orgId } })).id;
    const member = await createMember(admin, { name: "Demo Member", gender: "Male", phone: "9822300002", source: "Walk-in", tags: [] });
    await db.member.create({ data: { orgId, branchId: gym.a.id, code: `W-${Date.now()}`, name: "Walk-in", phone: "9822300003", gender: "Male", source: "Walk-in", walkIn: true, createdById: admin.id } as never });
    await sellMembership(admin, member.id, { planId, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "UPI" });
    const cat = await db.expenseCategory.findFirstOrThrow();
    await db.expense.create({ data: { orgId, branchId: gym.a.id, code: `EXP-${Date.now()}`, date: new Date(), categoryId: cat.id, description: "Rent", amount: 100000, method: "Cash", createdById: admin.id } });
    await db.lead.create({ data: { orgId, branchId: gym.a.id, name: "Lead", phone: "9822300004", source: "Walk-in", interest: "Monthly", ownerId: admin.id } });
    const slot = await db.classSlot.create({ data: { orgId, branchId: gym.a.id, name: "Yoga", trainerId: admin.id, weekday: 1, startTime: "07:00", durationMin: 60, capacity: 10 } });
    await db.booking.create({ data: { classSlotId: slot.id, date: new Date(), memberId: member.id, status: "BOOKED" } });
    const product = await db.product.create({ data: { orgId, branchId: gym.a.id, sku: `SKU-${Date.now()}`, name: "Whey", category: "Supplements", price: 300000, cost: 200000 } });
    await db.stockMovement.create({ data: { productId: product.id, qty: 5, reason: "Purchase", createdById: admin.id } });
    await db.asset.create({ data: { orgId, branchId: gym.a.id, code: `AST-${Date.now()}`, name: "Treadmill", category: "Cardio", purchaseDate: new Date(), cost: 10000000, method: "Bank", createdById: admin.id } });
    const purchase = await db.purchase.create({ data: { orgId, branchId: gym.a.id, code: `PUR-${Date.now()}`, date: new Date(), vendor: "Vendor", total: 100000, createdById: admin.id } });
    await db.purchaseLine.create({ data: { purchaseId: purchase.id, type: "Stock", description: "Whey", qty: 1, rate: 100000, gstPct: 18, amount: 100000 } });
    await db.vendorPayment.create({ data: { purchaseId: purchase.id, code: `VP-${Date.now()}`, date: new Date(), amount: 100000, method: "Cash", createdById: admin.id } });
    const mandate = await db.autopayMandate.create({ data: { code: `MAN-${Date.now()}`, orgId, branchId: gym.a.id, memberId: member.id, planId, amount: 150000, months: 1, mode: "demo", createdById: admin.id } });
    await db.autopayEvent.create({ data: { mandateId: mandate.id, eventId: `evt-${Date.now()}`, type: "created", payload: {} } });
    await db.whatsAppMessage.create({ data: { orgId, templateKey: "welcome", toNumber: "9822300002", body: "Hi", provider: "demo", status: "SENT" } });
    await db.notification.create({ data: { orgId, type: "info", text: "Hello" } });
    await db.monthLock.create({ data: { branchId: gym.a.id, month: "2026-01", lockedById: admin.id, lockedAt: new Date() } });
    await putSetting(admin, "opening", { cash: 1000 });
    await db.sequence.upsert({ where: { orgId_name: { orgId, name: "test-seq" } }, create: { orgId, name: "test-seq", next: 5 }, update: { next: 5 } });
    const otherMember = await createMember(otherAdmin, { name: "Other Member", gender: "Female", phone: "9822300005", source: "Walk-in", tags: [] });
    const otherPlan = (await createPlan(otherAdmin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: true, features: [] })).id;
    await sellMembership(otherAdmin, otherMember.id, { planId: otherPlan, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "UPI" });

    const removed = await clearDemoData(admin);
    expect(removed.members).toBe(2);
    expect(removed.invoices).toBe(1);

    const counts = await Promise.all([
      db.member.count({ where: { orgId } }),
      db.membership.count({ where: { member: { orgId } } }),
      db.invoice.count({ where: { orgId } }),
      db.invoiceItem.count({ where: { invoice: { orgId } } }),
      db.payment.count({ where: { orgId } }),
      db.expense.count({ where: { orgId } }),
      db.lead.count({ where: { orgId } }),
      db.classSlot.count({ where: { orgId } }),
      db.booking.count({ where: { classSlot: { orgId } } }),
      db.product.count({ where: { orgId } }),
      db.stockMovement.count({ where: { product: { orgId } } }),
      db.asset.count({ where: { orgId } }),
      db.purchase.count({ where: { orgId } }),
      db.purchaseLine.count({ where: { purchase: { orgId } } }),
      db.vendorPayment.count({ where: { purchase: { orgId } } }),
      db.autopayMandate.count({ where: { orgId } }),
      db.autopayEvent.count({ where: { mandate: { orgId } } }),
      db.whatsAppMessage.count({ where: { orgId } }),
      db.notification.count({ where: { orgId } }),
      db.monthLock.count({ where: { branch: { orgId } } }),
      db.sequence.count({ where: { orgId } }),
      db.setting.count({ where: { orgId, key: "opening" } }),
    ]);
    expect(counts).toEqual(counts.map(() => 0));
    expect((await db.organization.findUniqueOrThrow({ where: { id: orgId } })).demo).toBe(false);
    expect(await db.branch.count({ where: { orgId } })).toBe(2);
    expect(await db.user.count({ where: { orgId } })).toBeGreaterThan(0);
    expect(await db.membershipPlan.count({ where: { orgId } })).toBe(1);
    expect(await db.setting.count({ where: { orgId, key: { in: ["security", "privacy"] } } })).toBe(2);
    expect(await db.auditLog.count({ where: { orgId, action: "demo.clear", entity: "Organization", entityId: orgId } })).toBe(1);
    expect(await db.member.findUnique({ where: { id: otherMember.id } })).not.toBeNull();
    expect(await db.invoice.count({ where: { orgId: other.org.id } })).toBe(1);
    await expect(clearDemoData(admin)).rejects.toThrow(/nothing to clear/);
  });
});
