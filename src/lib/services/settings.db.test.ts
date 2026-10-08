import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { getGymProfile, getSetting, putSetting, saveGymProfile, saveTax } from "./settings";
import { getTax } from "./tax";
import { DEFAULT_REMINDERS, getReminderSettings, getWaSettings, listTemplates } from "./whatsapp";
import { getAccessRules } from "./attendance";
import { saveReminderSettings } from "./reminders";
import { nextInvoiceNumber, sellMembership } from "./billing";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("gym profile and Billing & GST settings (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  const auditRows = (orgId: string, entityId: string) => db.auditLog.count({ where: { orgId, entity: "Setting", entityId } });

  beforeAll(async () => {
    gym = await makeGym();
    admin = await gym.user("Super Admin");
  });

  it("falls back to the organisation's name when the profile has none", async () => {
    const fresh = await makeGym();
    expect((await getGymProfile(fresh.org.id)).name).toBe(fresh.org.name);
    await db.setting.create({ data: { orgId: fresh.org.id, key: "gym", value: { tagline: "No name yet" } } });
    expect(await getGymProfile(fresh.org.id)).toEqual({ name: fresh.org.name, tagline: "No name yet" });
  });

  it("stores every field, renames the organisation and keeps the logo", async () => {
    await putSetting(admin, "gym", { logoKey: `${admin.orgId}/gym/logo-x.png` });
    const before = await auditRows(admin.orgId, "gym");
    await saveGymProfile(admin, {
      name: "Power Haus Gym Bokaro",
      tagline: "Built Stronger",
      address: "C-7, Sector 4",
      state: "Jharkhand",
      phone: "7319742490",
      email: "hello@powerhausgym.in",
      website: "powerhausgym.in",
      instagram: "@powerhausbokaro",
    });
    const p = await getGymProfile(admin.orgId);
    expect(p).toMatchObject({ name: "Power Haus Gym Bokaro", tagline: "Built Stronger", state: "Jharkhand", phone: "7319742490", website: "powerhausgym.in", instagram: "@powerhausbokaro", logoKey: `${admin.orgId}/gym/logo-x.png` });
    expect((await db.organization.findUniqueOrThrow({ where: { id: admin.orgId } })).name).toBe("Power Haus Gym Bokaro");
    expect(await auditRows(admin.orgId, "gym")).toBe(before + 1);
    const row = await db.auditLog.findFirst({ where: { orgId: admin.orgId, entity: "Setting", entityId: "gym" }, orderBy: { id: "desc" } });
    expect(row?.action).toBe("setting.update");
    expect(row?.before).toMatchObject({ logoKey: `${admin.orgId}/gym/logo-x.png` });
    expect(row?.after).toMatchObject({ name: "Power Haus Gym Bokaro", logoKey: `${admin.orgId}/gym/logo-x.png` });

    // Blanks clear a field without touching the logo.
    await saveGymProfile(admin, { name: "Power Haus Gym" });
    const again = await getGymProfile(admin.orgId);
    expect(again.tagline).toBe("");
    expect(again.logoKey).toBe(`${admin.orgId}/gym/logo-x.png`);
  });

  it("saves GST settings and only rewrites the numbering row when the prefix changes", async () => {
    const taxBefore = await auditRows(admin.orgId, "tax");
    const numBefore = await auditRows(admin.orgId, "numbering");
    await saveTax(admin, { enabled: true, rate: 18, type: "CGST+SGST", gstin: "20ABCDE1234F1Z5", sac: "999723", invoicePrefix: "INV-" });
    expect(await getTax(admin.orgId)).toEqual({ enabled: true, rate: 18, type: "CGST+SGST", gstin: "20ABCDE1234F1Z5", sac: "999723" });
    expect(await auditRows(admin.orgId, "tax")).toBe(taxBefore + 1);
    expect(await auditRows(admin.orgId, "numbering")).toBe(numBefore); // INV- is already the default

    await saveTax(admin, { enabled: false, rate: 5, type: "IGST", sac: "999723", invoicePrefix: "PHG-" });
    expect(await getTax(admin.orgId)).toMatchObject({ enabled: false, rate: 5, type: "IGST", gstin: "" });
    expect(await getSetting<{ invoicePrefix?: string }>(admin.orgId, "numbering")).toMatchObject({ invoicePrefix: "PHG-" });
    expect(await auditRows(admin.orgId, "numbering")).toBe(numBefore + 1);

    await saveTax(admin, { enabled: false, rate: 5, type: "IGST", sac: "999723", invoicePrefix: "PHG-" });
    expect(await auditRows(admin.orgId, "numbering")).toBe(numBefore + 1);
  });

  it("merges saved tax values over the defaults", async () => {
    const fresh = await makeGym();
    const u = await fresh.user("Super Admin");
    await putSetting(u, "tax", { rate: 12 });
    expect(await getTax(fresh.org.id)).toEqual({ enabled: true, rate: 12, type: "CGST+SGST", sac: "999723" });
  });

  it("reads the next invoice number without taking it", async () => {
    const fresh = await makeGym();
    const u = pick(await fresh.user("Super Admin"), fresh.a.id);
    expect(await nextInvoiceNumber(fresh.org.id)).toBe(1001);
    expect(await nextInvoiceNumber(fresh.org.id)).toBe(1001);
    const planId = (await createPlan(u, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: true, features: [] })).id;
    const m = await createMember(u, { name: "Seq Member", gender: "Male", phone: "9811199001", source: "Walk-in", tags: [] });
    const { invoice } = await sellMembership(u, m.id, { planId, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 0 });
    expect(invoice.number).toBe("INV-1001");
    expect(await nextInvoiceNumber(fresh.org.id)).toBe(1002);
    expect(await nextInvoiceNumber(fresh.org.id)).toBe(1002);
  });

  it("reads the reminder schedule: defaults, then what the old WhatsApp form saved, then the Reminders row", async () => {
    const fresh = await makeGym();
    expect(await getReminderSettings(fresh.org.id)).toEqual(DEFAULT_REMINDERS);
    await db.setting.create({ data: { orgId: fresh.org.id, key: "whatsapp", value: { mode: "connector", expiryDays: [3], dedupDays: 9 } } });
    expect(await getReminderSettings(fresh.org.id)).toEqual({ ...DEFAULT_REMINDERS, expiryDays: [3], dedupDays: 9 });
    expect(await getWaSettings(fresh.org.id)).toEqual({ mode: "connector", quietFrom: "21:00", quietTo: "08:00", linked: null, dedupDays: 9, dueEveryDays: 3 });
    await db.setting.create({ data: { orgId: fresh.org.id, key: "reminders", value: { expiryDays: [15, 0], dedupDays: 2 } } });
    expect(await getReminderSettings(fresh.org.id)).toEqual({ ...DEFAULT_REMINDERS, expiryDays: [15, 0], dedupDays: 2 });
  });

  it("saves the Reminders tab: schedule to one row, grace to the door rules, each one audited", async () => {
    const fresh = await makeGym();
    const u = await fresh.user("Super Admin");
    await putSetting(u, "access", { blockExpired: false, duesLimit: 50000, graceDays: 1 });
    const remBefore = await auditRows(u.orgId, "reminders");
    const accBefore = await auditRows(u.orgId, "access");

    await saveReminderSettings(u, { expiryDays: [15, 0], dedupDays: 5, dueEveryDays: 0, defaultMonths: 3, graceDays: 4, birthdays: false });
    expect(await getWaSettings(u.orgId)).toEqual({ mode: "demo", quietFrom: "21:00", quietTo: "08:00", linked: null, dedupDays: 5, dueEveryDays: 0 });
    // The pills and birthday wishes are the templates' Auto-send switches.
    const on = new Map((await listTemplates(u.orgId)).map((t) => [t.key, t.autoSend]));
    expect([on.get("exp15"), on.get("exp7"), on.get("exp3"), on.get("exp1"), on.get("expired"), on.get("birthday")]).toEqual([true, false, false, false, true, false]);
    expect(await getAccessRules(u.orgId)).toMatchObject({ graceDays: 4, blockExpired: false, duesLimit: 50000, blockSuspended: true });
    expect(await auditRows(u.orgId, "reminders")).toBe(remBefore + 1);
    expect(await auditRows(u.orgId, "access")).toBe(accBefore + 1);
    const rows = await db.auditLog.findMany({ where: { orgId: u.orgId, entity: "Setting", entityId: { in: ["reminders", "access"] } }, orderBy: { id: "desc" }, take: 2 });
    expect(rows.map((r) => r.action)).toEqual(["setting.update", "setting.update"]);
    expect(rows.every((r) => r.userId === u.id)).toBe(true);
    expect(rows.find((r) => r.entityId === "reminders")?.after).toMatchObject({ expiryDays: [15, 0], defaultMonths: 3, birthdays: false });
    expect(rows.find((r) => r.entityId === "access")?.before).toMatchObject({ graceDays: 1 });

    // Same grace again: only the reminders row is rewritten.
    await saveReminderSettings(u, { expiryDays: [7], dedupDays: 5, dueEveryDays: 2, defaultMonths: 3, graceDays: 4, birthdays: true });
    expect(await auditRows(u.orgId, "reminders")).toBe(remBefore + 2);
    expect(await auditRows(u.orgId, "access")).toBe(accBefore + 1);
    expect(await getReminderSettings(u.orgId)).toMatchObject({ expiryDays: [7], dueEveryDays: 2, birthdays: true });
  });
});
