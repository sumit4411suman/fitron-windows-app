import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { hasDb, makeGym, pick, planEndingOn } from "@/test/db";
import { createMember, summarize } from "./members";
import { createPlan } from "./plans";
import { cancelInvoice, sellMembership } from "./billing";
import { expiryKey, lastRenewalReminders, remindAllOverdue, remindDue, remindRenewal, renewalAmounts, sendInvoiceWhatsApp } from "./reminders";
import { todayIso } from "./time";
import { putSetting } from "./settings";
import { saveConnectorSite } from "./wa-connector-store";
import { isLocal } from "@/lib/runtime/edition";

describe.skipIf(!hasDb)("reminders (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let owing: string;
  let ending: string;
  let fortnight: string;

  beforeAll(async () => {
    gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const today = todayIso();
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    owing = (await createMember(admin, { name: "Owes", gender: "Male", phone: "9876522001", source: "Walk-in", tags: [] })).id;
    ending = (await createMember(admin, { name: "Ends Soon", gender: "Female", phone: "9876522002", source: "Walk-in", tags: [] })).id;
    const sale = await sellMembership(admin, owing, { planId: plan.id, startDate: addDays(today, -20), discount: 0, includeRegFee: false, payAmount: 0 });
    // Make the unpaid invoice overdue.
    await db.invoice.update({ where: { id: sale.invoice.id }, data: { dueDate: new Date(`${addDays(today, -10)}T00:00:00Z`) } });
    await sellMembership(admin, ending, { planId: plan.id, startDate: addDays(today, -28), discount: 10000, includeRegFee: false, payAmount: 140000, payMethod: "UPI" });
    fortnight = (await createMember(admin, { name: "Ends In Two Weeks", gender: "Male", phone: "9876522003", source: "Walk-in", tags: [] })).id;
    // A plan that ends in exactly 15 days, whatever today's date (a one-month plan does not always fit: planEndingOn).
    const fit = planEndingOn(addDays(today, 15));
    const fortnightPlan = fit.months === 1 ? plan : await createPlan(admin, { name: `${fit.months} months`, kind: "Membership", months: fit.months, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    await sellMembership(admin, fortnight, { planId: fortnightPlan.id, startDate: fit.startDate, discount: 0, includeRegFee: false, payAmount: 0 });
  });

  it("picks the expiry template by days left", () => {
    expect([expiryKey(15), expiryKey(10), expiryKey(8), expiryKey(7), expiryKey(5), expiryKey(3), expiryKey(1), expiryKey(0), expiryKey(-4)]).toEqual(["exp15", "exp15", "exp15", "exp7", "exp7", "exp3", "exp1", "expired", "expired"]);
  });

  it("sends a due reminder once, then skips repeats within the window", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    // Demo mode (the default) saves the message without sending it, and says so.
    expect(await remindDue(desk, owing)).toMatchObject({ status: "Logged", templateKey: "due" });
    expect(await remindDue(desk, owing)).toBeNull();
    expect(await remindAllOverdue(desk)).toEqual({ sent: 0, queued: 0, logged: 0, failed: 0, skipped: 1 });
  });

  it("sends the right renewal reminder and reports it as the last one", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    expect(await remindRenewal(desk, ending)).toMatchObject({ status: "Logged" });
    const last = (await lastRenewalReminders([ending])).get(ending);
    const end = (await summarize([ending])).get(ending)!.latestEnd!;
    expect(last?.templateKey).toBe(expiryKey(daysBetween(end, todayIso())));
    expect((await renewalAmounts([ending])).get(ending)).toBe(140000);
  });

  it("sends the 15-day reminder to a member whose membership ends in 15 days", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    expect(daysBetween((await summarize([fortnight])).get(fortnight)!.latestEnd!, todayIso())).toBe(15);
    expect(await remindRenewal(desk, fortnight)).toMatchObject({ status: "Logged", templateKey: "exp15" });
    const msg = await db.whatsAppMessage.findFirst({ where: { memberId: fortnight }, orderBy: { sentAt: "desc" } });
    expect(msg).toMatchObject({ templateKey: "exp15", status: "Logged" });
    expect(msg!.body).toContain("15 days from now");
    expect((await lastRenewalReminders([fortnight])).get(fortnight)?.templateKey).toBe("exp15");
  });

  it("checks WhatsApp once before reminding everyone: with the connector not running nothing is sent or recorded", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    await putSetting(admin, "whatsapp", { mode: "connector" });
    // Where the connector is: the server's settings on fitron.in, the gym's own on Windows (Settings › WhatsApp).
    vi.stubEnv("WA_CONNECTOR_URL", "http://127.0.0.1:9");
    vi.stubEnv("WA_CONNECTOR_KEY", "x");
    if (isLocal()) await saveConnectorSite(gym.org.id, { url: "http://127.0.0.1:9", key: "x" });
    try {
      const before = await db.whatsAppMessage.count({ where: { orgId: gym.org.id } });
      await expect(remindAllOverdue(admin)).rejects.toThrow(/^Nothing was sent\. Nothing is answering at http:\/\/127\.0\.0\.1:9/);
      expect(await db.whatsAppMessage.count({ where: { orgId: gym.org.id } })).toBe(before);
    } finally {
      vi.unstubAllEnvs();
      if (isLocal()) await saveConnectorSite(gym.org.id, null);
      await putSetting(admin, "whatsapp", { mode: "demo" });
    }
  });

  it("doesn't count a reminder only logged before WhatsApp was linked as a repeat, and reports a failed send", async () => {
    const desk = await gym.user("Receptionist", [gym.a.id]);
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    // The due reminder above was logged in demo mode. Now the gym switches to the connector, which is not set up here.
    await putSetting(admin, "whatsapp", { mode: "connector" });
    try {
      const r = await remindDue(desk, owing);
      expect(r?.status).toBe("Failed");
      expect(r?.error).toBeTruthy();
      // "Remind all" checks once first, and sends nothing rather than recording a failure against everyone.
      await expect(remindAllOverdue(desk)).rejects.toThrow(/^Nothing was sent\./);
    } finally {
      await putSetting(admin, "whatsapp", { mode: "demo" });
    }
  });
});

describe.skipIf(!hasDb)("send an invoice on WhatsApp (database)", () => {
  let gymA: Awaited<ReturnType<typeof makeGym>>;
  let gymB: Awaited<ReturnType<typeof makeGym>>;
  let invoiceA: string;
  let invoiceB: string;

  beforeAll(async () => {
    gymA = await makeGym();
    gymB = await makeGym();
    for (const [g, set] of [
      [gymA, (id: string) => (invoiceA = id)],
      [gymB, (id: string) => (invoiceB = id)],
    ] as const) {
      const admin = pick(await g.user("Super Admin"), g.a.id);
      const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
      const m = await createMember(admin, { name: "Invoice Member", gender: "Female", phone: g === gymA ? "9876522101" : "9876522102", source: "Walk-in", tags: [] });
      set((await sellMembership(admin, m.id, { planId: plan.id, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 0 })).invoice.id);
    }
  });

  it("sends the invoice with its PDF to the invoice's own member", async () => {
    const desk = await gymA.user("Receptionist", [gymA.a.id]);
    // Not linked (demo mode): saved with the PDF attached, and the desk is told it was not sent.
    expect(await sendInvoiceWhatsApp(desk, invoiceA)).toMatchObject({ status: "Logged", templateKey: "invoice" });
    const msg = await db.whatsAppMessage.findFirst({ where: { attachment: `invoice:${invoiceA}` }, orderBy: { sentAt: "desc" }, include: { member: true } });
    expect(msg).toMatchObject({ orgId: desk.orgId, templateKey: "invoice", status: "Logged" });
    expect(msg!.member!.name).toBe("Invoice Member");
  });

  it("another gym's invoice is not found, and nothing is recorded for it", async () => {
    const deskA = await gymA.user("Receptionist", [gymA.a.id]);
    await expect(sendInvoiceWhatsApp(deskA, invoiceB)).rejects.toThrow("Invoice not found.");
    expect(await db.whatsAppMessage.count({ where: { attachment: `invoice:${invoiceB}` } })).toBe(0);
  });

  it("a second press moments after a real send is not sent again", async () => {
    const desk = await gymA.user("Receptionist", [gymA.a.id]);
    // As if the first press had gone out through a linked phone.
    await db.whatsAppMessage.updateMany({ where: { attachment: `invoice:${invoiceA}` }, data: { status: "Sent" } });
    expect(await sendInvoiceWhatsApp(desk, invoiceA)).toBeNull();
    expect(await db.whatsAppMessage.count({ where: { attachment: `invoice:${invoiceA}` } })).toBe(1);
  });

  it("a cancelled invoice is not sent", async () => {
    const admin = pick(await gymB.user("Super Admin"), gymB.a.id);
    await cancelInvoice(admin, invoiceB, "Entered by mistake");
    await expect(sendInvoiceWhatsApp(admin, invoiceB)).rejects.toThrow("cancelled");
  });
});
