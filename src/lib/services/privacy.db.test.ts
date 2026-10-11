import { beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays, addMonths } from "@/lib/domain/dates";
import { DEFAULT_NOTICE } from "@/lib/domain/privacy";
import { createMember, recordConsent, restoreMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { uploadDocument } from "./documents";
import { memberVars, sendTemplate } from "./whatsapp";
import { createMandate } from "./autopay";
import { enrol, saveDevice } from "./biometric";
import { addProgress } from "./programs";
import { createLead } from "./leads";
import { putSetting } from "./settings";
import { runDailyJobs } from "./jobs";
import { todayIso } from "./time";
import { assertCanErase, countConsented, eraseMember, exportMemberData, findMemberByCode, getPrivacySettings, listPrivacyRequests, savePrivacyNotice } from "./privacy";

const pdf = (text: string) => new File([`%PDF-1.4\n${text}`], "scan.pdf", { type: "application/pdf" });

describe.skipIf(!hasDb)("Privacy & DPDP (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let planId: string;
  let storageDir: string;
  let phone = 9811100000;
  const today = todayIso();
  const newMember = async (name: string, over = {}) => createMember(admin, { name, gender: "Female", phone: String(phone++), source: "Walk-in", tags: ["vip"], ...over });
  const sale = (memberId: string, startDate: string, payAmount: number) => sellMembership(admin, memberId, { planId, startDate, discount: 0, includeRegFee: false, payAmount, ...(payAmount ? { payMethod: "Cash" as const } : {}) });

  beforeAll(async () => {
    storageDir = mkdtempSync(path.join(tmpdir(), "fitron-privacy-"));
    vi.stubEnv("STORAGE_DIR", storageDir);
    vi.stubEnv("S3_BUCKET", "");
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] })).id;
  });

  it("officer and notice are settings with an audit trail", async () => {
    await putSetting(admin, "privacy", { officer: "Asha Rao", email: "privacy@test.local", phone: "9876543210", retainMonths: 12 });
    let s = await getPrivacySettings(gym.org.id);
    expect(s).toMatchObject({ officer: "Asha Rao", email: "privacy@test.local", retainMonths: 12, notice: {} });
    expect(s.cookieNotice).toMatch(/essential browser storage/);

    await savePrivacyNotice(admin, { ...DEFAULT_NOTICE, why: `${DEFAULT_NOTICE.why} We never share it for marketing.` });
    s = await getPrivacySettings(gym.org.id);
    expect(Object.keys(s.notice)).toEqual(["why"]);
    expect(s.noticeUpdatedAt).toBe(today);
    expect(s.officer).toBe("Asha Rao");

    await savePrivacyNotice(admin, null);
    expect((await getPrivacySettings(gym.org.id)).notice).toEqual({});
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "setting.update", entity: "Setting", entityId: "privacy" } })).toBeGreaterThanOrEqual(3);
  });

  it("export returns the member's data and records an access request", async () => {
    const m = await newMember("Export Devi");
    await sale(m.id, today, 100000);
    await uploadDocument(admin, m.id, { kind: "ID proof", title: "Aadhaar" }, pdf("id"));
    await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "campaign", body: "Hi {{member_name}}, test." });
    const { filename, json } = await exportMemberData(admin, m.id);
    expect(filename).toBe(`${m.code}-personal-data.json`);
    expect(json.member.code).toBe(m.code);
    expect(json.member.name).toBe("Export Devi");
    expect(json.amountsIn).toBe("paise");
    expect(json.invoices).toHaveLength(1);
    expect(json.invoices[0]!.total).toBe(100000);
    expect(json.payments).toHaveLength(1);
    expect(json.messages).toHaveLength(1);
    expect(json.documents).toHaveLength(1);
    expect(json.memberships).toHaveLength(1);
    expect(json.member.devicePin).toBeNull();
    expect(JSON.stringify(json)).not.toMatch(/biometricTemplate|"data":/);
    const log = await db.auditLog.findFirst({ where: { orgId: gym.org.id, action: "member.export", entityId: m.id } });
    expect(log?.after).toMatchObject({ code: m.code, name: "Export Devi", counts: { invoices: 1, payments: 1, messages: 1, documents: 1 } });
    const reqs = await listPrivacyRequests(admin);
    expect(reqs[0]).toMatchObject({ type: "Access (data export)", who: `Export Devi (${m.code})`, status: "Completed" });
  });

  it("export is scoped to the gym and branches", async () => {
    const m = await newMember("Scoped Devi");
    expect(await findMemberByCode(admin, m.code.toLowerCase())).not.toBeNull();
    const other = await makeGym();
    expect(await findMemberByCode(await other.user("Super Admin"), m.code)).toBeNull();
    expect(await findMemberByCode(pick(await gym.user("Super Admin"), gym.b.id), m.code)).toBeNull();
    await expect(exportMemberData(pick(await gym.user("Super Admin"), gym.b.id), m.id)).rejects.toThrow(/not found/);
  });

  it("erase refuses a member who still owes or is still active", async () => {
    const owes = await newMember("Owes Devi");
    await sale(owes.id, addMonths(today, -3), 0);
    await expect(eraseMember(admin, owes.id, "asked")).rejects.toThrow(/Settle the ₹1,000 balance/);

    const active = await newMember("Active Devi");
    await sale(active.id, today, 100000);
    await expect(eraseMember(admin, active.id, "asked")).rejects.toThrow(/still a member till/);

    const mandated = await newMember("Mandate Devi");
    await createMandate(admin, { memberId: mandated.id, planId });
    await expect(eraseMember(admin, mandated.id, "asked")).rejects.toThrow(/still a member till/);

    const lapsed = await newMember("Lapsed Devi");
    await sale(lapsed.id, addMonths(today, -3), 100000);
    await expect(eraseMember(admin, lapsed.id, " ")).rejects.toThrow(/reason/i);
    expect(await eraseMember(admin, lapsed.id, "Member asked under DPDP")).toMatchObject({ code: lapsed.code, documents: 0, messages: 0 });
  });

  it("erase anonymises and keeps money", async () => {
    const serial = `P${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    const device = await saveDevice(admin, { serial, name: "Door", branchId: gym.a.id, relaySeconds: 5 });
    const lead = await createLead(admin, { name: "Gone Devi", phone: "9811199999", source: "Walk-in", interest: "Gym", ownerId: admin.id });
    const m = await createMember(admin, { name: "Gone Devi", gender: "Female", phone: "9811199999", email: "gone@test.local", source: "Walk-in", tags: ["vip"] }, { leadId: lead.id });
    await sale(m.id, addMonths(today, -3), 100000);
    await enrol(admin, m.id, device.id, "FP", true);
    const doc = await uploadDocument(admin, m.id, { kind: "ID proof", title: "Aadhaar" }, pdf("gone"));
    const file = path.join(storageDir, doc.storageKey);
    expect(existsSync(file)).toBe(true);
    await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "campaign", body: "Hi {{member_name}}, bye." });
    await addProgress(admin, m.id, { date: today, weightKg: 70, notes: "knee pain" });
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).devicePin).not.toBeNull();

    const r = await eraseMember(admin, m.id, "Member asked under DPDP");
    expect(r).toEqual({ code: m.code, documents: 1, messages: 1 });

    const after = await db.member.findUniqueOrThrow({ where: { id: m.id } });
    expect(after).toMatchObject({ name: "Erased member", phone: "", email: null, tags: [], devicePin: null, biometricConsentAt: null, code: m.code, gender: "Female" });
    expect(after.erasedAt).not.toBeNull();
    expect(after.deletedAt).not.toBeNull();
    expect(await db.memberDocument.count({ where: { memberId: m.id } })).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(await db.whatsAppMessage.count({ where: { memberId: m.id } })).toBe(0);
    expect(await db.biometricTemplate.count({ where: { memberId: m.id } })).toBe(0);
    expect(await db.deviceUser.count({ where: { memberId: m.id } })).toBe(0);
    const p = await db.progressLog.findFirst({ where: { memberId: m.id } });
    expect(p?.notes).toBeNull();
    expect(Number(p?.weightKg)).toBe(70);
    expect(await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ name: "Erased member", phone: "" });
    expect(await db.invoice.count({ where: { memberId: m.id } })).toBe(1);
    expect(await db.payment.count({ where: { memberId: m.id } })).toBe(1);
    expect((await db.invoice.findFirstOrThrow({ where: { memberId: m.id }, include: { member: true } })).member.name).toBe("Erased member");

    const log = await db.auditLog.findFirstOrThrow({ where: { orgId: gym.org.id, action: "member.erase", entityId: m.id } });
    const text = JSON.stringify(log.before) + JSON.stringify(log.after);
    expect(text).not.toContain("Gone Devi");
    expect(text).not.toContain("9811199999");
    expect(log.after).toMatchObject({ code: m.code, reason: "Member asked under DPDP", documents: 1, messages: 1, biometrics: true });
    expect(log.before).toMatchObject({ code: m.code, fields: expect.arrayContaining(["name", "phone", "email", "tags"]) });
    expect((await listPrivacyRequests(admin))[0]).toMatchObject({ type: "Erasure", who: m.code });

    await expect(eraseMember(admin, m.id, "again")).rejects.toThrow(/already erased/);
    await expect(restoreMember(admin, m.id)).rejects.toThrow(/can't be restored/);
    const again = await createMember(admin, { name: "New Devi", gender: "Female", phone: "9811199999", source: "Walk-in", tags: [] });
    expect(again.id).not.toBe(m.id);

    // Nothing is ever rendered for an erased member.
    expect(await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "campaign", body: "Hi" })).toBeNull();
    expect(await db.whatsAppMessage.count({ where: { memberId: m.id } })).toBe(0);
  });

  it("erase needs members.delete", async () => {
    const base = await gym.user("Receptionist");
    const perms = new Set([...base.perms, "settings.manage"]);
    const desk = { ...base, perms, can: (p: string) => perms.has(p) } as typeof base;
    expect(() => assertCanErase(desk)).toThrow(/delete members/);
    expect(() => assertCanErase(admin)).not.toThrow();
  });

  it("messages can name the grievance officer, and consent counts only members with a recorded consent", async () => {
    const m = await newMember("Vars Devi");
    expect(await memberVars(gym.org.id, m.id)).toMatchObject({ grievance_officer: "Asha Rao", grievance_email: "privacy@test.local", grievance_phone: "9876543210" });
    const before = await countConsented(admin);
    expect(before.total).toBeGreaterThan(0);
    // Members made without the tick box (as every member above) are not counted as consented.
    expect(before.consented).toBeLessThan(before.total);
    expect(m.consentAt).toBeNull();

    const ticked = await newMember("Ticked Devi", { consent: true });
    expect(ticked.consentAt).toBeInstanceOf(Date);
    await recordConsent(admin, m.id);
    const after = await countConsented(admin);
    expect(after.total).toBe(before.total + 1);
    expect(after.consented).toBe(before.consented + 2);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "member.consent", entityId: m.id } })).toBe(1);
    // Recording twice keeps the first date.
    const first = (await db.member.findUniqueOrThrow({ where: { id: m.id } })).consentAt;
    await recordConsent(admin, m.id, new Date(0));
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).consentAt).toEqual(first);
  });

  it("retention job erases only lapsed members past the cutoff", async () => {
    const fresh = await makeGym();
    const boss = pick(await fresh.user("Super Admin"), fresh.a.id);
    const plan = await createPlan(boss, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const mk = async (name: string) => createMember(boss, { name, gender: "Male", phone: String(phone++), source: "Walk-in", tags: [] });
    const sell = (id: string, start: string) => sellMembership(boss, id, { planId: plan.id, startDate: start, discount: 0, includeRegFee: false, payAmount: 100000, payMethod: "Cash" });
    const a = await mk("A Lapsed");
    const b = await mk("B Lapsed");
    const c = await mk("C Active");
    const d = await mk("D Erased");
    await sell(a.id, addMonths(today, -3));
    await sell(b.id, addDays(addMonths(today, -1), 1));
    await sell(c.id, today);
    await sell(d.id, addMonths(today, -4));
    // Joined before the cutoff: the job never erases someone the day after they signed up.
    await db.member.updateMany({ where: { id: { in: [a.id, b.id, c.id, d.id] } }, data: { createdAt: new Date(Date.now() - 200 * 86_400_000) } });
    await eraseMember(boss, d.id, "asked");

    await putSetting(boss, "privacy", { retainMonths: 0 });
    let run = (await runDailyJobs(fresh.org.id, today)).find((j) => j.name === "privacy.retention");
    expect(run?.result).toEqual({ erased: 0, note: "off" });

    await putSetting(boss, "privacy", { retainMonths: 1 });
    await db.jobRun.deleteMany({ where: { orgId: fresh.org.id, name: "privacy.retention" } });
    run = (await runDailyJobs(fresh.org.id, today)).find((j) => j.name === "privacy.retention");
    expect(run?.result).toEqual({ erased: 1, retainMonths: 1 });
    expect((await db.member.findUniqueOrThrow({ where: { id: a.id } })).erasedAt).not.toBeNull();
    expect((await db.member.findUniqueOrThrow({ where: { id: b.id } })).name).toBe("B Lapsed");
    expect((await db.member.findUniqueOrThrow({ where: { id: c.id } })).name).toBe("C Active");
    const log = await db.auditLog.findFirstOrThrow({ where: { orgId: fresh.org.id, action: "member.erase", entityId: a.id } });
    expect(log.userId).toBeNull();
    expect(log.actorType).toBe("SYSTEM");
    expect(log.after).toMatchObject({ reason: "Retention period of 1 months ended" });
  });
});
