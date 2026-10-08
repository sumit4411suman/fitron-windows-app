import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays, membershipEndDate } from "@/lib/domain/dates";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { createInvoice, sellMembership } from "./billing";
import { changeMandate, createMandate } from "./autopay";
import { automationPreview, dispatchScheduled, previewTemplate, runAutomationNow, runOne, runRules } from "./wa-automation";
import { editRule, getWaSettings, listTemplates, sendTest, setLinked } from "./whatsapp";
import { putSetting } from "./settings";
import { runDailyJobs } from "./jobs";
import { istInstant, todayIso } from "./time";

type Gym = Awaited<ReturnType<typeof makeGym>>;
type User = Awaited<ReturnType<Gym["user"]>>;
const today = todayIso();
const at10 = istInstant(today, "10:00");

/** A one-month membership that ends in exactly `days` days, whatever the month length. */
const startEndingIn = (days: number) => {
  const end = addDays(today, days);
  for (let k = 27; k <= 31; k++) if (membershipEndDate(addDays(end, -k), 1) === end) return addDays(end, -k);
  throw new Error("no start date");
};

describe.skipIf(!hasDb)("WhatsApp automation rules (database)", () => {
  let gym: Gym;
  let admin: User;
  let planId: string;
  let away: string;
  let noNumber: string;
  let onAutopay: string;
  const row = (rows: Awaited<ReturnType<typeof automationPreview>>, key: string) => rows.find((r) => r.key === key);

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: true, features: [] })).id;
    const pt = (memberId: string) => createInvoice(admin, { memberId, date: addDays(today, -10), dueDate: addDays(today, -5), lines: [{ description: "PT", category: "Personal Training", qty: 1, rate: 50000, discount: 0, taxable: false }], payAmount: 0 });
    // A balance overdue 5 days (payment reminder) on an active member.
    const m = await createMember(admin, { name: "Away Member", gender: "Male", phone: "9888800001", source: "Walk-in", tags: [] });
    away = m.id;
    await sellMembership(admin, away, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 118000, payMethod: "Cash" });
    await pt(away);
    // The same, without a WhatsApp number.
    const n = await createMember(admin, { name: "No Number", gender: "Female", phone: "9888800002", source: "Walk-in", tags: [] });
    noNumber = n.id;
    await sellMembership(admin, noNumber, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 118000, payMethod: "Cash" });
    await pt(noNumber);
    await db.member.update({ where: { id: noNumber }, data: { phone: "12345", whatsapp: null } });
    // Ends in 7 days, on an active UPI autopay mandate.
    const a = await createMember(admin, { name: "Autopay Member", gender: "Male", phone: "9888800003", source: "Walk-in", tags: [] });
    onAutopay = a.id;
    await sellMembership(admin, onAutopay, { planId, startDate: startEndingIn(7), discount: 0, includeRegFee: false, payAmount: 118000, payMethod: "UPI" });
    const md = await createMandate(admin, { memberId: onAutopay, planId });
    await changeMandate(admin, md.id, "approve-demo");
  });

  it("seeds every template with the prototype's rule", async () => {
    const t = new Map((await listTemplates(gym.org.id)).map((x) => [x.key, x]));
    expect(t.get("due")).toMatchObject({ ruleWhen: "dues_age", ruleDays: 5, ruleTime: "07:00", ruleMaxPerWeek: 3, ruleExcludeAutopay: false });
    expect(t.get("exp7")).toMatchObject({ ruleWhen: "before_expiry", ruleDays: 7, ruleExcludeAutopay: true });
    expect(t.get("expired")).toMatchObject({ ruleWhen: "after_expiry", ruleDays: 0 });
    expect(t.get("welcome")).toMatchObject({ ruleWhen: "event" });
    expect(t.get("campaign")).toMatchObject({ ruleWhen: "manual" });
  });

  it("previews who each rule reaches today and why others are skipped", async () => {
    const rows = await automationPreview(admin, today, at10);
    const due = row(rows, "due")!;
    expect(due.name).toBe("Payment reminder");
    expect(due.time).toBe("7:00 am");
    expect(due.send.map((c) => c.name)).toEqual(["Away Member"]);
    expect(due.send[0]).toMatchObject({ planName: "Monthly", phone: "9888800001" });
    expect(due.skipped.map((s) => [s.cand.name, s.why])).toEqual([["No Number", "Invalid WhatsApp number"]]);
    const exp7 = row(rows, "exp7")!;
    expect(exp7.send).toEqual([]);
    expect(exp7.skipped.map((s) => [s.cand.name, s.why])).toEqual([["Autopay Member", "On UPI autopay"]]);
    // No visit since joining today: the win-back rule (14 days) doesn't apply yet.
    expect(row(rows, "winback")).toBeUndefined();
    const p = await previewTemplate(admin, "due", today, at10);
    expect(p.sample).toContain("Hi Away");
    expect(p.sample).toContain("₹500");
  });

  it("Edit rule changes who matches, saves quiet hours, and is audited", async () => {
    await editRule(admin, "due", { when: "dues_age", days: 6 });
    expect(row(await automationPreview(admin, today, at10), "due")).toBeUndefined();
    await editRule(admin, "due", { when: "dues_age", days: 5, quietFrom: "20:00", quietTo: "08:00" });
    expect(row(await automationPreview(admin, today, at10), "due")?.send).toHaveLength(1);
    const audits = await db.auditLog.findMany({ where: { orgId: gym.org.id, action: "whatsapp.rule", entityId: "due" }, orderBy: { id: "asc" } });
    expect(audits).toHaveLength(2);
    expect(audits[0]!.before).toMatchObject({ ruleDays: 5 });
    expect(audits[0]!.after).toMatchObject({ ruleWhen: "dues_age", ruleDays: 6 });
    expect(await getWaSettings(gym.org.id)).toMatchObject({ quietFrom: "20:00", quietTo: "08:00" });
    const setting = await db.auditLog.findFirst({ where: { orgId: gym.org.id, action: "setting.update", entityId: "whatsapp" }, orderBy: { id: "desc" } });
    expect(setting?.after).toMatchObject({ quietFrom: "20:00" });
    await editRule(admin, "due", { when: "dues_age", days: 5, quietFrom: "21:00", quietTo: "08:00" });
    await expect(editRule(admin, "due", { when: "dues_age", days: "" })).rejects.toThrow("Enter the number of days.");
    await expect(editRule(admin, "due", { when: "dues_age", days: 5, planId: "nope" })).rejects.toThrow(/plan/);
  });

  it("stops at the weekly limit of automated messages per member", async () => {
    await editRule(admin, "due", { when: "dues_age", days: 5, maxPerWeek: 1 });
    const auto = { orgId: gym.org.id, memberId: away, toNumber: "919888800001", body: "x", provider: "demo", status: "Logged", sentById: null };
    const rows = await db.whatsAppMessage.createManyAndReturn({ data: [{ ...auto, templateKey: "exp7" }, { ...auto, templateKey: "exp3" }] });
    expect(row(await automationPreview(admin, today, at10), "due")?.skipped.map((s) => [s.cand.name, s.why])).toContainEqual(["Away Member", "Weekly limit of 1 reached"]);
    await db.whatsAppMessage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await editRule(admin, "due", { when: "dues_age", days: 5, maxPerWeek: 3 });
  });

  it("Preview & run sends, records the run, and the repeat window turns the next run into skips", async () => {
    const first = await runOne(admin, "due", today, at10);
    expect(first).toMatchObject({ sent: 1, skipped: 1, held: 0 });
    const msgs = await db.whatsAppMessage.findMany({ where: { memberId: away, templateKey: "due" } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ status: "Logged", sentById: admin.id });
    expect(msgs[0]!.body).toContain("₹500");
    const runs = (await db.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: gym.org.id, key: "wa_auto_runs" } } })).value as { key: string; name: string; sent: number; skipped: number }[];
    expect(runs[0]).toMatchObject({ key: "due", name: "Payment reminder", sent: 1, skipped: 1, matched: 2, by: admin.id });
    const second = await runOne(admin, "due", today, at10);
    expect(second).toMatchObject({ sent: 0, skipped: 2 });
    expect(row(await automationPreview(admin, today, at10), "due")?.skipped.map((s) => s.why)).toContain("Already sent within 3 days");
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "whatsapp.automation.run" } })).toBe(2);
  });

  it("refuses runs by hand inside quiet hours", async () => {
    const before = await db.whatsAppMessage.count({ where: { orgId: gym.org.id } });
    await expect(runOne(admin, "due", today, istInstant(today, "23:00"))).rejects.toThrow(/Quiet hours \(9:00 pm – 8:00 am\)\. Messages will go out at 8:00 am\./);
    await expect(runAutomationNow(admin, today, istInstant(today, "23:00"))).rejects.toThrow(/Quiet hours \(9:00 pm – 8:00 am\)/);
    expect(await db.whatsAppMessage.count({ where: { orgId: gym.org.id } })).toBe(before);
  });

  it("only previews and sends to members in the user's branches", async () => {
    const b = pick(await gym.user("Super Admin"), gym.b.id);
    const m = await createMember(b, { name: "Branch B Member", gender: "Male", phone: "9888800009", source: "Walk-in", tags: [] });
    await sellMembership(b, m.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 118000, payMethod: "Cash" });
    await createInvoice(b, { memberId: m.id, date: addDays(today, -10), dueDate: addDays(today, -5), lines: [{ description: "PT", category: "Personal Training", qty: 1, rate: 50000, discount: 0, taxable: false }], payAmount: 0 });
    const names = (r?: { send: { name: string }[]; skipped: { cand: { name: string } }[] }) => [...(r?.send ?? []).map((c) => c.name), ...(r?.skipped ?? []).map((s) => s.cand.name)];
    expect(names(row(await automationPreview(admin, today, at10), "due"))).not.toContain("Branch B Member");
    expect(names(row(await automationPreview(b, today, at10), "due"))).toEqual(["Branch B Member"]);
    await runAutomationNow(admin, today, at10);
    expect(await db.whatsAppMessage.count({ where: { memberId: m.id } })).toBe(0);
  });

  it("links and unlinks the gym's WhatsApp with an audit trail", async () => {
    await setLinked(admin, { number: "7319742490", device: "Fitron connector · localhost", at: at10.toISOString() }, "connector");
    expect(await getWaSettings(gym.org.id)).toMatchObject({ mode: "connector", linked: { number: "7319742490", device: "Fitron connector · localhost" } });
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "whatsapp.link", entityId: "whatsapp" } })).toBe(1);
    await setLinked(admin, null, "demo");
    expect(await getWaSettings(gym.org.id)).toMatchObject({ mode: "demo", linked: null });
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "whatsapp.unlink" } })).toBe(1);
  });

  it("sends a test message to the gym's phone, or says which phone to add", async () => {
    await expect(sendTest(admin)).rejects.toThrow("Add the gym phone in Gym profile first.");
    await putSetting(admin, "gym", { phone: "9876543210" });
    const msg = await sendTest(admin);
    expect(msg).toMatchObject({ memberId: null, templateKey: "test", status: "Logged", toNumber: "919876543210", sentById: admin.id });
    const a = await db.auditLog.findFirst({ where: { orgId: gym.org.id, action: "whatsapp.test", entityId: msg.id } });
    expect(a?.after).toMatchObject({ status: "Logged" });
  });

  it("keeps automation behind settings.manage", async () => {
    expect((await gym.user("Admin")).can("settings.manage")).toBe(false);
    expect(admin.can("settings.manage")).toBe(true);
  });
});

describe.skipIf(!hasDb)("quiet hours hold the daily job's messages (database)", () => {
  let gym: Gym;
  let admin: User;
  let memberId: string;

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] })).id;
    memberId = (await createMember(admin, { name: "Seven Days", gender: "Female", phone: "9888800021", source: "Walk-in", tags: [] })).id;
    await sellMembership(admin, memberId, { planId, startDate: startEndingIn(7), discount: 0, includeRegFee: false, payAmount: 100000, payMethod: "Cash" });
  });

  it("holds a 6:30 run until 8:00 and the dispatcher sends it once", async () => {
    const out = await runDailyJobs(gym.org.id, today, istInstant(today, "06:30"));
    expect(out.find((j) => j.name === "reminders.expiry")).toMatchObject({ status: "ran", result: { sent: 0, skipped: 0, held: 1 } });
    const held = await db.whatsAppMessage.findMany({ where: { memberId } });
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ templateKey: "exp7", status: "Scheduled", sentById: null });
    expect(held[0]!.scheduledFor).toEqual(istInstant(today, "08:00"));
    // The held message counts as sent, so nothing is queued twice.
    expect((await automationPreview(admin, today, at10)).find((r) => r.key === "exp7")?.skipped.map((s) => s.why)).toEqual(["Already sent within 3 days"]);
    expect(await dispatchScheduled(gym.org.id, istInstant(today, "07:30"))).toEqual({ sent: 0, failed: 0, stillHeld: 1 });
    expect(await dispatchScheduled(gym.org.id, istInstant(today, "08:05"))).toEqual({ sent: 1, failed: 0, stillHeld: 0 });
    expect((await db.whatsAppMessage.findMany({ where: { memberId } })).map((m) => m.status)).toEqual(["Logged"]);
    expect(await dispatchScheduled(gym.org.id, istInstant(today, "08:20"))).toEqual({ sent: 0, failed: 0, stillHeld: 0 });
    expect(await db.whatsAppMessage.count({ where: { memberId } })).toBe(1);
  });

  it("the system run is audited as SYSTEM", async () => {
    const a = await db.auditLog.findFirst({ where: { orgId: gym.org.id, action: "whatsapp.automation.run" }, orderBy: { id: "desc" } });
    expect(a).toMatchObject({ actorType: "SYSTEM", userId: null });
    expect(a?.after).toMatchObject([{ key: "exp7", held: 1, sent: 0 }]);
    expect(await runRules(gym.org.id, null, ["exp7"], today, at10, null)).toMatchObject({ sent: 0, skipped: 1, held: 0 });
  });
});
