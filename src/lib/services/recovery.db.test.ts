import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { collectPayment, sellMembership } from "./billing";
import { closeCase, getCase, listCases, logAttempt, recordCasePayment, recoveryDashboard, refreshQueue, reopenCase, sendCaseReminder } from "./recovery";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("revenue recovery (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<typeof gym.user>>;
  let planId: string;
  let owing: { id: string };
  let lapsed: { id: string };
  let owingInvoice: string;
  const today = todayIso();

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150_000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    planId = plan.id;
    owing = await createMember(admin, { name: "Owes Money", gender: "Male", phone: "9876521001", source: "Walk-in", tags: [] });
    lapsed = await createMember(admin, { name: "Lapsed Member", gender: "Female", phone: "9876521002", source: "Instagram", tags: [] });
    const paid = await createMember(admin, { name: "Paid Up", gender: "Female", phone: "9876521003", source: "Walk-in", tags: [] });
    // Owing: a plan sold 40 days ago, nothing paid, due on the sale day → 40 days overdue.
    const s = await sellMembership(admin, owing.id, { planId, startDate: addDays(today, -40), discount: 0, includeRegFee: false, payAmount: 0 });
    owingInvoice = s.invoice.id;
    await db.invoice.update({ where: { id: owingInvoice }, data: { date: new Date(`${addDays(today, -40)}T00:00:00Z`), dueDate: new Date(`${addDays(today, -40)}T00:00:00Z`) } });
    // Lapsed: a plan that ended 10 days ago, fully paid.
    await sellMembership(admin, lapsed.id, { planId, startDate: addDays(today, -40), discount: 0, includeRegFee: false, payAmount: 150_000, payMethod: "Cash" });
    // Paid: current and paid, nothing to recover.
    await sellMembership(admin, paid.id, { planId, startDate: addDays(today, -5), discount: 0, includeRegFee: false, payAmount: 150_000, payMethod: "UPI" });
  });

  it("opens one case per overdue invoice and one per lapsed membership, and a second refresh changes nothing", async () => {
    // "Owes Money" has both an overdue invoice and a lapsed plan: a dues case and a renewal opportunity (flagged as owing).
    const first = await refreshQueue(admin, today);
    expect(first).toMatchObject({ opened: 1, renewalsOpened: 2 });
    const second = await refreshQueue(admin, today);
    expect(second).toMatchObject({ opened: 0, renewalsOpened: 0, updated: 3 });
    const { rows, total } = await listCases(admin);
    expect(total).toBe(3);
    const dues = rows.find((r) => r.kind === "DUES")!;
    expect(dues).toMatchObject({ memberId: owing.id, invoiceId: owingInvoice, openingAmount: 150_000, balance: 150_000, overdueDays: 40, status: "OPEN", nextAction: "Send a WhatsApp reminder" });
    expect(dues.priority).toBeGreaterThan(0);
    const renewal = rows.find((r) => r.kind === "RENEWAL" && r.memberId === lapsed.id)!;
    expect(renewal).toMatchObject({ openingAmount: 150_000, status: "OPEN", nextAction: "Send a renewal message" });
    const owingRenewal = rows.find((r) => r.kind === "RENEWAL" && r.memberId === owing.id)!;
    expect(owingRenewal.priority).toBeLessThan(renewal.priority); // dues count against the opportunity
    expect(await db.recoveryCase.count({ where: { orgId: gym.org.id } })).toBe(3);
  });

  it("reports the dashboard metrics with their definitions and the recovery rate's denominator", async () => {
    const d = await recoveryDashboard(admin, { from: `${today.slice(0, 7)}-01`, to: today }, today);
    expect(d.outstanding).toBe(150_000);
    expect(d.eligible).toBe(150_000);
    expect(d.pending).toBe(1);
    expect(d.recovered).toBe(0);
    expect(d.denominator).toBe(150_000);
    expect(d.rate).toBe(0);
    expect(d.renewalOpportunities).toBe(2);
    expect(d.aging.find((a) => a.bucket === "31–60 days")).toEqual({ bucket: "31–60 days", count: 1, amount: 150_000 });
    expect(d.byBranch.find((b) => b.id === gym.a.id)).toMatchObject({ open: 1, outstanding: 150_000, recovered: 0 });
    expect(d.byPlan).toEqual([{ plan: "Monthly", open: 1, outstanding: 150_000, recovered: 0 }]);
    const rate = d.metrics.find((m) => m.id === "recovery.rate")!;
    expect(rate.definition).toContain("÷");
    expect(rate.kind).toBe("actual");
  });

  it("records attempts and moves the next step on; a promise waits", async () => {
    const dues = (await listCases(admin, { kind: "DUES" })).rows[0]!;
    await logAttempt(admin, dues.id, { kind: "CALL", outcome: "PROMISED", promisedOn: addDays(today, 3), promisedAmount: 150_000, note: "Will pay on Friday" });
    const c = await getCase(admin, dues.id);
    expect(c).toMatchObject({ status: "IN_PROGRESS", attempts: 1, promisedAmount: 150_000, nextAction: "Wait for the promised payment, then check" });
    expect(c.attemptsLog[0]).toMatchObject({ kind: "CALL", outcome: "PROMISED", note: "Will pay on Friday" });
    await expect(logAttempt(admin, dues.id, { kind: "CALL", outcome: "PROMISED" })).rejects.toThrow("Enter the date they promised");
  });

  it("sends the reminder through the normal WhatsApp path (demo mode logs it) and records how it went", async () => {
    const dues = (await listCases(admin, { kind: "DUES" })).rows[0]!;
    const r = await sendCaseReminder(admin, dues.id);
    expect(["LOGGED", "SENT", "QUEUED"]).toContain(r.outcome);
    const c = await getCase(admin, dues.id);
    expect(c.attemptsLog[0]).toMatchObject({ kind: "WHATSAPP", outcome: r.outcome });
    expect(c.attemptsLog[0]!.whatsAppMessageId).toBeTruthy();
    // A second press is de-duplicated by the reminder settings, so nothing is sent twice.
    const again = await sendCaseReminder(admin, dues.id);
    expect(again.outcome).toBe("SKIPPED");
    const desk = await gym.user("Trainer", [gym.a.id]);
    await expect(sendCaseReminder(desk, dues.id)).rejects.toThrow("can't send WhatsApp");
  });

  it("records a part payment through Collect payment, keeps the case open, then closes it as recovered on the balance", async () => {
    const dues = (await listCases(admin, { kind: "DUES" })).rows[0]!;
    const r = await recordCasePayment(admin, dues.id, { amount: 50_000, method: "UPI", date: today });
    expect(r.balanceLeft).toBe(100_000);
    expect(r.payment.amount).toBe(50_000);
    let c = await getCase(admin, dues.id);
    expect(c).toMatchObject({ status: "IN_PROGRESS", recoveredAmount: 50_000, balance: 100_000 });
    expect(c.attemptsLog[0]).toMatchObject({ kind: "PAYMENT", outcome: "PAID", paymentId: r.payment.id });
    // The same amount again a moment later is a double click.
    await expect(recordCasePayment(admin, dues.id, { amount: 50_000, method: "UPI", date: today })).rejects.toThrow("a moment ago");
    // More than the balance is refused by Collect payment itself.
    await expect(recordCasePayment(admin, dues.id, { amount: 200_000, method: "Cash", date: today })).rejects.toThrow("balance is only");
    const done = await recordCasePayment(admin, dues.id, { amount: 100_000, method: "Cash", date: today });
    expect(done.balanceLeft).toBe(0);
    c = await getCase(admin, dues.id);
    expect(c).toMatchObject({ status: "RECOVERED", recoveredAmount: 150_000, balance: 0 });
    // The books agree: two payments, invoice paid, and the recovery report counts them once.
    expect(await db.payment.count({ where: { invoiceId: owingInvoice, status: "SUCCESS" } })).toBe(2);
    const d = await recoveryDashboard(admin, { from: `${today.slice(0, 7)}-01`, to: today }, today);
    expect(d.recovered).toBe(150_000);
    expect(d.rate).toBe(100);
    expect(d.eligible).toBe(0);
  });

  it("counts a payment taken at the front desk on a case's invoice as recovered too", async () => {
    const m = await createMember(admin, { name: "Desk Payer", gender: "Male", phone: "9876521004", source: "Walk-in", tags: [] });
    const s = await sellMembership(admin, m.id, { planId, startDate: addDays(today, -20), discount: 0, includeRegFee: false, payAmount: 0 });
    await db.invoice.update({ where: { id: s.invoice.id }, data: { dueDate: new Date(`${addDays(today, -20)}T00:00:00Z`) } });
    await refreshQueue(admin, today);
    await collectPayment(admin, s.invoice.id, { amount: 150_000, method: "Cash", date: today });
    await refreshQueue(admin, today);
    const c = (await listCases(admin, { status: "closed" })).rows.find((r) => r.invoiceId === s.invoice.id)!;
    expect(c).toMatchObject({ status: "RECOVERED", recoveredAmount: 150_000 });
  });

  it("closes a renewal opportunity when the member buys again, and closes and reopens a case by hand", async () => {
    const renewal = (await listCases(admin, { kind: "RENEWAL" })).rows.find((r) => r.memberId === lapsed.id)!;
    await sellMembership(admin, lapsed.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 150_000, payMethod: "Cash" });
    const r = await refreshQueue(admin, today);
    expect(r.renewed).toBe(1);
    expect((await getCase(admin, renewal.id)).status).toBe("RENEWED");
    const m = await createMember(admin, { name: "Write Off", gender: "Male", phone: "9876521005", source: "Walk-in", tags: [] });
    const s = await sellMembership(admin, m.id, { planId, startDate: addDays(today, -30), discount: 0, includeRegFee: false, payAmount: 0 });
    await db.invoice.update({ where: { id: s.invoice.id }, data: { dueDate: new Date(`${addDays(today, -30)}T00:00:00Z`) } });
    await refreshQueue(admin, today);
    const c = (await listCases(admin, { kind: "DUES" })).rows.find((x) => x.invoiceId === s.invoice.id)!;
    await closeCase(admin, c.id, "Member moved away");
    expect((await getCase(admin, c.id))).toMatchObject({ status: "CLOSED", closeReason: "Member moved away" });
    // A closed case is not reopened by the refresh.
    await refreshQueue(admin, today);
    expect((await getCase(admin, c.id)).status).toBe("CLOSED");
    await reopenCase(admin, c.id);
    expect((await getCase(admin, c.id)).status).toBe("OPEN");
  });

  it("keeps every gym and branch to itself", async () => {
    const other = await makeGym();
    const otherAdmin = await other.user("Super Admin");
    expect((await listCases(otherAdmin)).total).toBe(0);
    const mine = (await listCases(admin, { status: "all" })).rows[0]!;
    await expect(getCase(otherAdmin, mine.id)).rejects.toThrow("not found");
    await expect(closeCase(otherAdmin, mine.id, "x")).rejects.toThrow("not found");
    const branchB = pick(await gym.user("Super Admin"), gym.b.id);
    expect((await listCases(branchB, { status: "all" })).total).toBe(0);
    const d = await recoveryDashboard(otherAdmin, { from: `${today.slice(0, 7)}-01`, to: today }, today);
    expect(d.outstanding).toBe(0);
    expect(d.rate).toBeNull();
  });
});
