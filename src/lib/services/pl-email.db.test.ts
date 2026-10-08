import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { unzip } from "@/test/xlsx";

// The mail server is a list here: what would have been sent, and whether it is set up or failing.
const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string; attachments?: { filename: string; content: Uint8Array; contentType: string }[] }[], ready: true, failFor: new Set<string>() }));
vi.mock("@/lib/integrations/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/email")>()),
  emailReady: () => mail.ready,
  sendEmail: vi.fn(async (m: (typeof mail.sent)[number]) => {
    if (mail.failFor.has(m.to) || mail.failFor.has("*")) throw new Error("SMTP refused");
    mail.sent.push(m);
    return { sent: true as const };
  }),
}));

import { createMember } from "./members";
import { createInvoice } from "./billing";
import { createExpense } from "./expenses";
import { runDailyJobs } from "./jobs";
import { sendMonthlyPl } from "./pl-email";
import { putSetting } from "./settings";

const FIRST = "2026-10-01";
const NOW = new Date("2026-10-01T04:00:00Z");

beforeEach(() => {
  mail.sent = [];
  mail.ready = true;
  mail.failFor.clear();
});

/** A gym with a September sale of ₹1,000 (₹500 paid) and ₹300 of rent. */
async function septemberGym() {
  const gym = await makeGym();
  const owner = pick(await gym.user("Super Admin"), gym.a.id);
  const m = await createMember(owner, { name: "Sept Member", gender: "Female", phone: "9866610001", source: "Instagram", tags: [] });
  await createInvoice(owner, { memberId: m.id, date: "2026-09-15", dueDate: "2026-09-15", lines: [{ description: "PT", category: "Personal Training", qty: 1, rate: 100000, discount: 0, taxable: false }], payAmount: 50000, payMethod: "UPI" });
  await createExpense(owner, { date: "2026-09-10", categoryId: "rent", description: "Rent", amount: 30000, method: "Cash" });
  return { gym, owner };
}

const job = (runs: Awaited<ReturnType<typeof runDailyJobs>>) => runs.find((j) => j.name === "reports.monthly")!;

describe.skipIf(!hasDb)("monthly profit and loss email (database)", () => {
  it("goes to the Super Admin on the 1st with last month's figures and the statement attached", async () => {
    const { gym, owner } = await septemberGym();
    const r = job(await runDailyJobs(gym.org.id, FIRST, NOW));
    expect(r).toMatchObject({ status: "ran", result: { sent: 1, month: "2026-09" } });

    expect(mail.sent).toHaveLength(1);
    const m = mail.sent[0]!;
    expect(m.to).toBe(owner.email);
    expect(m.subject).toBe(`${gym.org.name}: profit and loss for Sep 2026`);
    expect(m.text).toContain("Revenue: ₹1,000");
    expect(m.text).toContain("Operating expenses: ₹300");
    expect(m.text).toContain("Net profit: ₹700  (70% of revenue)");
    expect(m.text).toContain("Money received in the month: ₹500");

    const file = m.attachments![0]!;
    expect(file).toMatchObject({ filename: "profit-and-loss_2026-09.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const parts = unzip(file.content);
    expect(parts["xl/workbook.xml"]).toContain('name="P&amp;L Sep 2026"');
    const sheet = parts["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain("Total revenue");
    expect(sheet).toMatch(/<c r="C\d+" s="2"><v>1000<\/v><\/c>/);
  });

  it("covers every active Super Admin who has an email, and nobody else", async () => {
    const { gym, owner } = await septemberGym();
    const second = await gym.user("Super Admin");
    const gone = await gym.user("Super Admin");
    await db.user.update({ where: { id: gone.id }, data: { active: false } });
    await gym.user("Receptionist");
    await runDailyJobs(gym.org.id, FIRST, NOW);
    expect(mail.sent.map((x) => x.to).sort()).toEqual([owner.email, second.email].sort());
  });

  it("is sent once for the month: not again on the 2nd or 3rd, nor on a second run", async () => {
    const { gym } = await septemberGym();
    await runDailyJobs(gym.org.id, FIRST, NOW);
    expect(job(await runDailyJobs(gym.org.id, FIRST, NOW)).status).toBe("skipped");
    expect(job(await runDailyJobs(gym.org.id, "2026-10-02", NOW)).result).toMatchObject({ sent: 0, note: "already sent" });
    expect(job(await runDailyJobs(gym.org.id, "2026-10-03", NOW)).result).toMatchObject({ sent: 0, note: "already sent" });
    expect(mail.sent).toHaveLength(1);
  });

  it("does nothing on other days of the month", async () => {
    const { gym } = await septemberGym();
    expect(job(await runDailyJobs(gym.org.id, "2026-10-04", NOW)).result).toMatchObject({ sent: 0 });
    expect(job(await runDailyJobs(gym.org.id, "2026-10-17", NOW)).result).toMatchObject({ sent: 0 });
    expect(mail.sent).toHaveLength(0);
  });

  it("stays quiet when the gym switched it off, and sends if it is switched on again within the three days", async () => {
    const { gym, owner } = await septemberGym();
    await putSetting(owner, "reports", { monthlyPl: false });
    expect(job(await runDailyJobs(gym.org.id, FIRST, NOW)).result).toMatchObject({ sent: 0, note: "off" });
    expect(mail.sent).toHaveLength(0);
    await putSetting(owner, "reports", { monthlyPl: true });
    expect(job(await runDailyJobs(gym.org.id, "2026-10-02", NOW)).result).toMatchObject({ sent: 1, month: "2026-09" });
    expect(mail.sent).toHaveLength(1);
  });

  it("is part of Accounting: a Starter gym, or one whose plan has ended, does not get it", async () => {
    const starter = await septemberGym();
    // A gym that signed up on a plan has a trial date; one set up by hand has none and keeps every feature.
    await db.organization.update({ where: { id: starter.gym.org.id }, data: { plan: "starter", trialEndsAt: new Date("2026-10-20T00:00:00Z") } });
    expect(job(await runDailyJobs(starter.gym.org.id, FIRST, NOW)).result).toMatchObject({ sent: 0, note: "not on the plan" });

    const lapsed = await septemberGym();
    await db.organization.update({ where: { id: lapsed.gym.org.id }, data: { trialEndsAt: new Date("2026-08-01T00:00:00Z") } });
    expect(job(await runDailyJobs(lapsed.gym.org.id, FIRST, NOW)).result).toMatchObject({ sent: 0, note: "plan ended" });
    expect(mail.sent).toHaveLength(0);
  });

  it("skips a month in which nothing happened", async () => {
    const gym = await makeGym();
    await gym.user("Super Admin");
    expect(job(await runDailyJobs(gym.org.id, FIRST, NOW)).result).toMatchObject({ sent: 0, note: "nothing happened that month" });
    expect(mail.sent).toHaveLength(0);
  });

  it("leaves the month open while the server has no mail set up", async () => {
    const { gym } = await septemberGym();
    mail.ready = false;
    expect(job(await runDailyJobs(gym.org.id, FIRST, NOW)).result).toMatchObject({ sent: 0, note: "email is not set up on this server" });
    mail.ready = true;
    expect(job(await runDailyJobs(gym.org.id, "2026-10-02", NOW)).result).toMatchObject({ sent: 1, month: "2026-09" });
  });

  it("when the mail server refuses everyone the job fails, the owner is told, and the next day tries again", async () => {
    const { gym, owner } = await septemberGym();
    mail.failFor.add("*");
    const r = job(await runDailyJobs(gym.org.id, FIRST, NOW));
    expect(r.status).toBe("failed");
    expect(r.error).toContain("could not be sent");
    const told = await db.notification.findMany({ where: { orgId: gym.org.id, type: "JOB_FAILED" } });
    expect(told.map((n) => n.text).join(" ")).toContain("profit and loss");
    expect(mail.sent).toHaveLength(0);

    mail.failFor.clear();
    expect(job(await runDailyJobs(gym.org.id, "2026-10-02", NOW)).result).toMatchObject({ sent: 1, month: "2026-09" });
    expect(mail.sent.map((x) => x.to)).toEqual([owner.email]);
  });

  it("when one address fails the others still get it, and the month counts as done", async () => {
    const { gym, owner } = await septemberGym();
    const second = await gym.user("Super Admin");
    mail.failFor.add(second.email);
    expect(job(await runDailyJobs(gym.org.id, FIRST, NOW)).result).toMatchObject({ sent: 1, failed: 1, month: "2026-09" });
    expect(mail.sent.map((x) => x.to)).toEqual([owner.email]);
    expect(job(await runDailyJobs(gym.org.id, "2026-10-02", NOW)).result).toMatchObject({ note: "already sent" });
  });

  it("adds up every branch of the gym", async () => {
    const { gym } = await septemberGym();
    const atB = pick(await gym.user("Super Admin"), gym.b.id);
    const m = await createMember(atB, { name: "Branch B Member", gender: "Male", phone: "9866610002", source: "Walk-in", tags: [] });
    await createInvoice(atB, { memberId: m.id, date: "2026-09-20", dueDate: "2026-09-20", lines: [{ description: "PT", category: "Personal Training", qty: 1, rate: 20000, discount: 0, taxable: false }], payAmount: 20000, payMethod: "Cash" });
    expect(await sendMonthlyPl(gym.org.id, FIRST, NOW)).toMatchObject({ sent: 2 }); // both Super Admins
    expect(mail.sent[0]!.text).toContain("Revenue: ₹1,200"); // ₹1,000 at A and ₹200 at B
    expect(mail.sent[0]!.text).toContain("Money received in the month: ₹700");
  });
});
