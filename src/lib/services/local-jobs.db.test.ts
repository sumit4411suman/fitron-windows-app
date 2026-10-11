import { saveConnectorSite } from "./wa-connector-store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { isLocal } from "@/lib/runtime/edition";
import { JOBS, LOCAL_JOBS, runDueOnThisComputer, runLocalDailyJobs } from "./jobs";
import { createMember } from "./members";
import { putSetting } from "./settings";
import { todayIso } from "./time";

// FITRON for Windows runs the gym's daily jobs on its own timer (src/lib/runtime/local-scheduler.ts): no server scheduler
// calls /api/jobs/daily on a laptop.

afterEach(() => vi.unstubAllEnvs());

describe("the jobs a computer runs", () => {
  it("are all the daily jobs but door devices, FITRON's branch billing and the server's own backups", () => {
    // Demo autopay debits book simulated UPI payments: never unasked on a gym's own computer.
    expect(JOBS.filter((j) => !LOCAL_JOBS.includes(j)).map((j) => j.name)).toEqual(["autopay", "devices.sync", "billing.branches", "backup.auto", "backup.nudge"]);
    expect(LOCAL_JOBS.map((j) => j.name)).toEqual(expect.arrayContaining(["members.risk", "attendance.close", "reminders.expiry", "leads.followup", "privacy.retention", "whatsapp.dispatch", "reports.monthly"]));
  });
});

describe.skipIf(!hasDb)("the computer's timer (database)", () => {
  it("runs each gym's jobs once a day, so a second pass the same day does nothing again", async () => {
    const g = await makeGym();
    const owner = pick(await g.user("Super Admin"), g.a.id);
    await createMember(owner, { name: "Risky Member", gender: "Male", phone: "9866620001", source: "Walk-in", tags: [] });
    const now = new Date();
    expect(await runDueOnThisComputer(now, [g.org.id])).toMatchObject({ gyms: 1, ran: LOCAL_JOBS.length, waiting: 0 });
    expect(await db.jobRun.count({ where: { orgId: g.org.id, day: todayIso(now) } })).toBe(LOCAL_JOBS.length);
    // Churn risk is worked out, so the dashboard's "Members at risk" is real on a computer too.
    expect(await db.member.count({ where: { orgId: g.org.id, riskScore: null, walkIn: false } })).toBe(0);
    expect(await runDueOnThisComputer(now, [g.org.id])).toMatchObject({ gyms: 1, ran: 0, waiting: 0 });
  });

  it.skipIf(!isLocal())("saves no reminders while WhatsApp is not linked, so none of them blocks a real one later", async () => {
    vi.stubEnv("FITRON_LOCAL_ALLOW_SIGNUP", "");
    const g = await makeGym();
    const owner = pick(await g.user("Super Admin"), g.a.id);
    await createMember(owner, { name: "Not Linked Member", gender: "Female", phone: "9866620002", source: "Walk-in", tags: [] });
    const out = await runLocalDailyJobs(g.org.id, todayIso());
    for (const name of ["reminders.expiry", "reminders.dues", "reminders.birthday", "reminders.winback", "reminders.autopay"]) expect(out.find((j) => j.name === name), name).toMatchObject({ status: "ran", result: { sent: 0, note: "WhatsApp is not linked: nothing sent" } });
    expect(await db.whatsAppMessage.count({ where: { orgId: g.org.id } })).toBe(0);
  });

  it.skipIf(!isLocal())("lets the WhatsApp jobs wait while WhatsApp cannot take messages, without a failure or an alert", async () => {
    const g = await makeGym();
    const owner = pick(await g.user("Super Admin"), g.a.id);
    await putSetting(owner, "whatsapp", { mode: "connector" });
    // A connector entered under Settings › WhatsApp › Connector that is not running.
    await saveConnectorSite(g.org.id, { url: "http://127.0.0.1:9", key: "x" });
    const today = todayIso();
    const out = await runLocalDailyJobs(g.org.id, today);
    const waiting = out.filter((j) => j.status === "waiting").map((j) => j.name);
    expect(waiting).toEqual(expect.arrayContaining(["reminders.expiry", "reminders.dues", "reminders.winback", "whatsapp.dispatch"]));
    expect(out.find((j) => j.name === "reminders.expiry")!.error).toMatch(/^Nothing is answering at http:\/\/127\.0\.0\.1:9/);
    expect(out.filter((j) => j.status === "failed")).toEqual([]);
    expect(await db.jobRun.count({ where: { orgId: g.org.id, day: today, name: { in: waiting } } })).toBe(0);
    expect(await db.notification.count({ where: { orgId: g.org.id, type: "JOB_FAILED" } })).toBe(0);
    // The jobs that need no internet ran.
    expect(out.find((j) => j.name === "members.risk")!.status).toBe("ran");
  });
});
