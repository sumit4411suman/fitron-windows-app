import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { cancelInvoice, collectPayment, createInvoice, getInvoice, listReceivables, reversePayment, sellMembership, suggestedStart } from "./billing";
import { UserError } from "./errors";
import { sellerOf } from "./invoice-seller";
import { saveGymProfile, saveTax } from "./settings";
import { todayIso } from "./time";
import { addDays, membershipEndDate } from "@/lib/domain/dates";
import { fmtDate } from "@/lib/format";

describe.skipIf(!hasDb)("billing (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let planId: string;
  let phone = 9811100000;
  const newMember = async () => createMember(admin, { name: "Test Member", gender: "Male", phone: String(phone++), source: "Walk-in", tags: [] });
  const today = todayIso();

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    // ₹4,000 plan + ₹500 registration, 18% GST
    planId = (await createPlan(admin, { name: "Quarterly", kind: "Membership", months: 3, price: 400000, regFee: 50000, discount: 0, gstApplicable: true, features: [] })).id;
  });

  const sale = (over = {}) => ({ planId, startDate: today, discount: 0, includeRegFee: true, payAmount: 0, ...over });

  it("sells a new membership with GST, part payment, and computed status", async () => {
    const m = await newMember();
    const r = await sellMembership(admin, m.id, sale({ payAmount: 200000, payMethod: "UPI" as const }));
    expect(r.invoice.total).toBe(531000); // (4000 + 500) × 1.18
    expect(r.membership.type).toBe("NEW");
    expect(r.membership.endDate.toISOString().slice(0, 10)).toBe(membershipEndDate(today, 3));
    const inv = await getInvoice(admin, r.invoice.id);
    expect(inv).toMatchObject({ status: "PARTIALLY_PAID", paid: 200000, balance: 331000 });
  });

  it("collects the balance and becomes PAID; refuses overpayment", async () => {
    const m = await newMember();
    const { invoice } = await sellMembership(admin, m.id, sale({ payAmount: 100000, payMethod: "Cash" as const }));
    await expect(collectPayment(admin, invoice.id, { amount: 999999, method: "UPI", date: today })).rejects.toThrow(UserError);
    await collectPayment(admin, invoice.id, { amount: invoice.total - 100000, method: "UPI", date: today });
    expect((await getInvoice(admin, invoice.id))?.status).toBe("PAID");
  });

  it("records the invoice number on the payment audit entry", async () => {
    const m = await newMember();
    const { invoice } = await sellMembership(admin, m.id, sale({ payAmount: 100000, payMethod: "Cash" as const }));
    const p = await collectPayment(admin, invoice.id, { amount: 1000, method: "UPI", date: today });
    const row = await db.auditLog.findFirstOrThrow({ where: { orgId: admin.orgId, action: "payment.create", entityId: p.id } });
    expect((row.after as { invoiceNumber?: string }).invoiceNumber).toBe(invoice.number);
    expect(row.hash).toBeTruthy();
  });

  it("renews from the day after the current membership ends, without a registration fee by default", async () => {
    const m = await newMember();
    const first = await sellMembership(admin, m.id, sale());
    const { start, isNew } = await suggestedStart(m.id);
    expect(isNew).toBe(false);
    expect(start).toBe(addDays(first.membership.endDate.toISOString().slice(0, 10), 1));
    const renewal = await sellMembership(admin, m.id, sale({ startDate: start, includeRegFee: false }));
    expect(renewal.membership.type).toBe("RENEWAL");
    expect(renewal.invoice.total).toBe(472000);
  });

  it("cancelling an invoice reverses its payments and cancels the membership", async () => {
    const m = await newMember();
    const { invoice, membership } = await sellMembership(admin, m.id, sale({ payAmount: 531000, payMethod: "UPI" as const }));
    await cancelInvoice(admin, invoice.id, "Sold by mistake");
    const inv = await getInvoice(admin, invoice.id);
    expect(inv).toMatchObject({ status: "CANCELLED", balance: 0 });
    expect(inv?.payments.every((p) => p.status === "REVERSED")).toBe(true);
    expect((await db.membership.findUnique({ where: { id: membership.id } }))?.status).toBe("CANCELLED");
  });

  it("reversing a payment puts the balance back", async () => {
    const m = await newMember();
    const { invoice, payment } = await sellMembership(admin, m.id, sale({ payAmount: 531000, payMethod: "UPI" as const }));
    await reversePayment(admin, payment!.id, "Bounced");
    expect(await getInvoice(admin, invoice.id)).toMatchObject({ status: "UNPAID", balance: 531000 });
    await expect(reversePayment(admin, payment!.id, "Again")).rejects.toThrow(/already reversed/);
  });

  it("blocks writes in a locked month for an Accountant but not a Super Admin", async () => {
    const m = await newMember();
    const { invoice } = await sellMembership(admin, m.id, sale());
    const month = today.slice(0, 7);
    await db.monthLock.create({ data: { branchId: gym.a.id, month, lockedById: admin.id, lockedAt: new Date() } });
    const accountant = pick(await gym.user("Accountant"), gym.a.id);
    await expect(collectPayment(accountant, invoice.id, { amount: 1000, method: "Cash", date: today })).rejects.toThrow(/locked/);
    await collectPayment(admin, invoice.id, { amount: 1000, method: "Cash", date: today });
    await db.monthLock.delete({ where: { branchId_month: { branchId: gym.a.id, month } } });
  });

  it("creates standalone invoices and lists receivables", async () => {
    const m = await newMember();
    const inv = await createInvoice(admin, {
      memberId: m.id,
      date: today,
      dueDate: today,
      lines: [{ description: "PT sessions", category: "Personal Training", qty: 4, rate: 50000, discount: 0, taxable: true }],
      payAmount: 0,
    });
    expect(inv.total).toBe(236000);
    const { list } = await listReceivables(admin, "unpaid");
    expect(list.some((r) => r.id === inv.id)).toBe(true);
  });

  it("keeps the seller details as they were when the invoice was made, whatever Settings say later", async () => {
    const m = await newMember();
    await saveGymProfile(admin, { name: "Snapshot Gym", tagline: "Old tagline", address: "1 Old Road", phone: "9000000001", email: "old@gym.test", instagram: "@old" });
    await saveTax(admin, { enabled: true, rate: 18, type: "CGST+SGST", gstin: "20OLDGSTIN0001Z5", sac: "999723", invoicePrefix: "INV-" });
    const inv = await createInvoice(admin, { memberId: m.id, date: today, dueDate: today, lines: [{ description: "PT", category: "Personal Training", qty: 1, rate: 100000, discount: 0, taxable: true }], payAmount: 0 });
    const before = await sellerOf((await getInvoice(admin, inv.id))!);
    expect(before).toMatchObject({ name: "Snapshot Gym", tagline: "Old tagline", address: "1 Old Road", gstin: "20OLDGSTIN0001Z5", sac: "999723" });
    expect(inv.gstRate && Number(inv.gstRate)).toBe(18);

    // The gym drops its GSTIN and changes its name and tagline.
    await saveTax(admin, { enabled: false, rate: 18, type: "CGST+SGST", gstin: "", sac: "", invoicePrefix: "INV-" });
    await saveGymProfile(admin, { name: "Renamed Gym", tagline: "New tagline", address: "2 New Road", phone: "9000000002", email: "", instagram: "" });
    const after = (await getInvoice(admin, inv.id))!;
    expect(after.seller).toEqual(inv.seller);
    expect(await sellerOf(after)).toEqual(before);
    expect(after.gstType).toBe("CGST+SGST");
    expect(Number(after.gstRate)).toBe(18);

    // A new invoice sees the new settings, and an invoice from before snapshots were kept falls back to them.
    const fresh = await createInvoice(admin, { memberId: m.id, date: today, dueDate: today, lines: [{ description: "PT", category: "Personal Training", qty: 1, rate: 100000, discount: 0, taxable: true }], payAmount: 0 });
    expect(await sellerOf((await getInvoice(admin, fresh.id))!)).toMatchObject({ name: "Renamed Gym", tagline: "New tagline", gstin: null });
    expect(await sellerOf({ ...after, seller: null })).toMatchObject({ name: "Renamed Gym", gstin: null });
  });

  it("numbers invoices without gaps", async () => {
    const m = await newMember();
    const a = await sellMembership(admin, m.id, sale());
    const b = await sellMembership(admin, m.id, sale({ startDate: (await suggestedStart(m.id)).start, includeRegFee: false }));
    expect(Number(b.invoice.number.split("-")[1])).toBe(Number(a.invoice.number.split("-")[1]) + 1);
  });

  it("refuses a second plan over dates the member already has, and says when the next one can start", async () => {
    const m = await newMember();
    const first = await sellMembership(admin, m.id, sale());
    const end = first.membership.endDate.toISOString().slice(0, 10);
    const invoices = await db.invoice.count({ where: { memberId: m.id } });
    // The same dates again, a start inside the plan, and a start before it that runs into it.
    for (const startDate of [today, addDays(today, 10), addDays(today, -5)]) {
      const err = await sellMembership(admin, m.id, sale({ startDate, includeRegFee: false })).catch((e: unknown) => e);
      expect(err, startDate).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain("already has Quarterly covering");
      expect((err as UserError).message).toContain("would overlap it");
      expect((err as UserError).message).toContain(`Start it on ${fmtDate(addDays(end, 1))}`);
    }
    expect(await db.invoice.count({ where: { memberId: m.id } })).toBe(invoices);
    expect(await db.membership.count({ where: { memberId: m.id } })).toBe(1);
    // A plan after it is fine, and a cancelled plan no longer blocks its dates.
    await sellMembership(admin, m.id, sale({ startDate: addDays(end, 1), includeRegFee: false }));
    await cancelInvoice(admin, first.invoice.id, "Sold by mistake");
    const again = await sellMembership(admin, m.id, sale({ includeRegFee: false }));
    expect(again.membership.startDate.toISOString().slice(0, 10)).toBe(today);
  });
});

describe.skipIf(!hasDb)("invoice PDF (database)", () => {
  it("renders the gym profile with and without a logo", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { vi } = await import("vitest");
    vi.stubEnv("STORAGE_DIR", mkdtempSync(path.join(tmpdir(), "fitron-pdf-")));
    vi.stubEnv("S3_BUCKET", "");
    const { invoicePdf } = await import("./invoice-pdf");
    const { saveGymProfile, saveTax } = await import("./settings");
    const { setGymLogo } = await import("./gym-logo");

    const gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: true, features: [] })).id;
    const m = await createMember(admin, { name: "PDF Member", gender: "Female", phone: "9811199002", source: "Walk-in", tags: [] });
    await saveGymProfile(admin, { name: "Power Haus Gym", tagline: "Built Stronger", address: "C-7, Sector 4, City Centre, Bokaro", phone: "7319742490", email: "hello@powerhausgym.in", instagram: "@powerhausbokaro" });
    await saveTax(admin, { enabled: true, rate: 18, type: "CGST+SGST", gstin: "20ABCDE1234F1Z5", sac: "999723", invoicePrefix: "INV-" });
    const { invoice } = await sellMembership(admin, m.id, { planId, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 0 });

    const plain = await invoicePdf(admin, invoice.id);
    expect(plain).not.toBeNull();
    expect(Buffer.from(plain!.bytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(plain!.filename).toBe("INV-1001.pdf");

    // A real 1×1 PNG, so pdf-lib can embed it.
    const onePx = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    await setGymLogo(admin, new File([onePx], "logo.png", { type: "image/png" }));
    const withLogo = await invoicePdf(admin, invoice.id);
    expect(Buffer.from(withLogo!.bytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(withLogo!.bytes.length).toBeGreaterThan(plain!.bytes.length);
  });
});
