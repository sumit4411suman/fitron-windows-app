import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { gstSplit } from "@/lib/domain/saas";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/integrations/email", () => ({
  emailReady: () => true,
  sendEmail: async (m: { to: string; subject: string; text: string }) => {
    sent.push(m);
    return { sent: true };
  },
}));

const { getSubscriptionSettings, gymWhatsAppNumber, saveBillingDetails, saveRenewalReminders } = await import("./subscription");
const { billingReminders, confirmDemoPayment, getBillingInvoice, startPayment } = await import("./saas");
const { putSetting } = await import("./settings");
const { fromIso, todayIso } = await import("./time");

describe.skipIf(!hasDb)("Settings › Subscription (database)", () => {
  const today = todayIso();

  beforeAll(() => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "");
  });
  afterAll(() => vi.unstubAllEnvs());

  it("saves reminders and billing details on one audited setting row without one form wiping the other", async () => {
    const gym = await makeGym();
    const owner = await gym.user("Super Admin");
    expect(await getSubscriptionSettings(gym.org.id)).toMatchObject({ remindDays: 7, whatsapp: true, email: true, legalName: "", gstin: "" });

    await saveBillingDetails(owner, { legalName: "Power Haus Fitness Pvt Ltd", gstin: "20ABCDE1234F1Z5", billingEmail: "accounts@powerhaus.in", address: "C-7, Sector 4" });
    await saveRenewalReminders(owner, { remindDays: 3, whatsapp: false, email: true });
    const cfg = await getSubscriptionSettings(gym.org.id);
    expect(cfg).toEqual({ remindDays: 3, whatsapp: false, email: true, legalName: "Power Haus Fitness Pvt Ltd", gstin: "20ABCDE1234F1Z5", billingEmail: "accounts@powerhaus.in", address: "C-7, Sector 4" });

    // Blank clears a value.
    await saveBillingDetails(owner, { legalName: "Power Haus Fitness Pvt Ltd" });
    expect(await getSubscriptionSettings(gym.org.id)).toMatchObject({ remindDays: 3, gstin: "", billingEmail: "", address: "" });

    const rows = await db.setting.findMany({ where: { orgId: gym.org.id, key: "subscription" } });
    expect(rows).toHaveLength(1);
    const logs = await db.auditLog.findMany({ where: { orgId: gym.org.id, action: "setting.update", entity: "Setting", entityId: "subscription" }, orderBy: { createdAt: "asc" } });
    expect(logs).toHaveLength(3);
    expect(logs[0]!.before).toBeNull();
    expect(logs[1]!.before).toMatchObject({ legalName: "Power Haus Fitness Pvt Ltd" });
    expect(logs[1]!.after).toMatchObject({ remindDays: 3, legalName: "Power Haus Fitness Pvt Ltd" });
    expect(logs.every((l) => l.userId === owner.id)).toBe(true);
  });

  it("finds the gym number in the profile, else the oldest branch with a phone", async () => {
    const gym = await makeGym();
    const owner = await gym.user("Super Admin");
    expect(await gymWhatsAppNumber(gym.org.id)).toBeNull();
    await db.branch.update({ where: { id: gym.b.id }, data: { phone: "9000000002" } });
    expect(await gymWhatsAppNumber(gym.org.id)).toBe("919000000002");
    await putSetting(owner, "gym", { phone: "9000000001" });
    expect(await gymWhatsAppNumber(gym.org.id)).toBe("919000000001");
  });

  it("reminds a trial gym on the bell, WhatsApp and email on the day the setting says, and not the day after", async () => {
    const gym = await makeGym();
    const owner = await gym.user("Super Admin");
    // The trial's last day is today + 6, so the sign-up-day-counted days left are 7.
    await db.organization.update({ where: { id: gym.org.id }, data: { plan: "professional", trialEndsAt: fromIso(addDays(today, 7)) } });
    await putSetting(owner, "gym", { phone: "9000000001" });
    await saveRenewalReminders(owner, { remindDays: 7, whatsapp: true, email: true });
    await saveBillingDetails(owner, { billingEmail: "accounts@powerhaus.in" });

    sent.length = 0;
    expect(await billingReminders(gym.org.id, today)).toEqual({ sent: 1, whatsapp: 1, email: 1 });
    const wa = await db.whatsAppMessage.findMany({ where: { orgId: gym.org.id } });
    expect(wa).toHaveLength(1);
    expect(wa[0]).toMatchObject({ memberId: null, templateKey: "fitron_renewal", toNumber: "919000000001", status: "Logged", provider: "demo" });
    expect(wa[0]!.body).toContain("free trial ends in 7 days");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "accounts@powerhaus.in", subject: "FITRON: your FITRON free trial ends in 7 days" });
    expect(sent[0]!.text).toContain("/settings/billing");
    const bell = await db.notification.findMany({ where: { orgId: gym.org.id, type: "BILLING" } });
    expect(bell).toHaveLength(1);
    expect(bell[0]!.text).toContain("free trial ends in 7 days");

    // Tomorrow 6 days are left: nothing.
    sent.length = 0;
    expect(await billingReminders(gym.org.id, addDays(today, 1))).toEqual({ sent: 0, whatsapp: 0, email: 0 });
    expect(sent).toHaveLength(0);
    expect(await db.whatsAppMessage.count({ where: { orgId: gym.org.id } })).toBe(1);

    // No billing email: every Super Admin's sign-in email.
    const second = await gym.user("Super Admin");
    await saveBillingDetails(owner, {});
    sent.length = 0;
    expect(await billingReminders(gym.org.id, today)).toEqual({ sent: 1, whatsapp: 1, email: 2 });
    expect(sent.map((m) => m.to).sort()).toEqual([owner.email, second.email].sort());
  });

  it("with both channels off only the bell rings; without any gym phone WhatsApp is skipped quietly", async () => {
    const gym = await makeGym();
    const owner = await gym.user("Super Admin");
    await db.organization.update({ where: { id: gym.org.id }, data: { plan: "starter", trialEndsAt: fromIso(addDays(today, 7)) } });
    await saveRenewalReminders(owner, { remindDays: 7, whatsapp: false, email: false });
    sent.length = 0;
    expect(await billingReminders(gym.org.id, today)).toEqual({ sent: 1, whatsapp: 0, email: 0 });
    expect(await db.notification.count({ where: { orgId: gym.org.id, type: "BILLING" } })).toBe(1);
    expect(await db.whatsAppMessage.count({ where: { orgId: gym.org.id } })).toBe(0);
    expect(sent).toHaveLength(0);

    await saveRenewalReminders(owner, { remindDays: 7, whatsapp: true, email: false });
    expect(await billingReminders(gym.org.id, today)).toEqual({ sent: 1, whatsapp: 0, email: 0 });
    expect(await db.whatsAppMessage.count({ where: { orgId: gym.org.id } })).toBe(0);
  });

  it("reminds a paid gym the set number of days before the period ends, naming the plan", async () => {
    const gym = await makeGym();
    const owner = await gym.user("Super Admin");
    await db.organization.update({ where: { id: gym.org.id }, data: { plan: "professional", trialEndsAt: fromIso(addDays(today, -30)) } });
    await saveRenewalReminders(owner, { remindDays: 3, whatsapp: false, email: false });
    const sub = await db.branchSubscription.create({
      data: { orgId: gym.org.id, kind: "PLAN", plan: "professional", cycle: "MONTHLY", base: 1_99_900, gst: 35_982, total: 2_35_882, mode: "DEMO", status: "PAID", paidAt: new Date(), periodStart: fromIso(addDays(today, -27)), periodEnd: fromIso(addDays(today, 3)), createdById: owner.id },
    });
    expect(await billingReminders(gym.org.id, today)).toEqual({ sent: 1, whatsapp: 0, email: 0 });
    const bell = await db.notification.findFirstOrThrow({ where: { orgId: gym.org.id, type: "BILLING" } });
    expect(bell.text).toContain(`Your Professional plan ends in 3 days (`);

    await db.branchSubscription.update({ where: { id: sub.id }, data: { periodEnd: fromIso(addDays(today, 5)) } });
    expect(await billingReminders(gym.org.id, today)).toEqual({ sent: 0, whatsapp: 0, email: 0 });
  });

  it("prints the billing details on the FITRON receipt and splits GST by the gym's own GSTIN", async () => {
    const gym = await makeGym();
    const owner = await gym.user("Super Admin");
    await db.organization.update({ where: { id: gym.org.id }, data: { plan: "enterprise", trialEndsAt: fromIso(addDays(today, 5)) } });
    const c = await startPayment(owner, { kind: "PLAN", plan: "enterprise" }, "MONTHLY");
    expect(c.mode).toBe("DEMO");
    await confirmDemoPayment(owner, c.id);

    const before = await getBillingInvoice(owner, c.id);
    expect(before?.buyer).toMatchObject({ name: gym.org.name, gstin: null, email: "" });

    await saveBillingDetails(owner, { legalName: "Power Haus Fitness Pvt Ltd", gstin: "20ABCDE1234F1Z5", billingEmail: "accounts@powerhaus.in", address: "C-7, Sector 4, City Centre, Bokaro" });
    const inv = await getBillingInvoice(owner, c.id);
    expect(inv?.buyer).toEqual({ name: "Power Haus Fitness Pvt Ltd", gstin: "20ABCDE1234F1Z5", address: "C-7, Sector 4, City Centre, Bokaro", email: "accounts@powerhaus.in" });

    vi.stubEnv("FITRON_GSTIN", "20FITRN1234A1Z9");
    expect(gstSplit(process.env.FITRON_GSTIN!, inv!.buyer.gstin, inv!.sub.gst).type).toBe("CGST_SGST");
    vi.stubEnv("FITRON_GSTIN", "29FITRN1234A1Z9");
    expect(gstSplit(process.env.FITRON_GSTIN!, inv!.buyer.gstin, inv!.sub.gst).type).toBe("IGST");
  });
});
