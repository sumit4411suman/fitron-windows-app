import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { computeRisk } from "./insights";
import { aiBrief, localChat } from "./ai-local";
import { getAiSettings } from "./ai-settings";
import { putSetting } from "./settings";
import { runDailyJobs } from "./jobs";
import { checkAutopayConnection, getAutopaySettings } from "./autopay";
import { POST } from "@/app/api/ai/chat/route";
import type { ChatEvent } from "./ai";
import { fromIso, todayIso } from "./time";

const mockUser = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/current", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/current")>()), getCurrentUser: async () => mockUser.current }));

describe.skipIf(!hasDb)("Settings › Integrations & AI (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  const today = todayIso();

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const b = await createMember(admin, { name: "Lapsing Lalit", gender: "Male", phone: "9844410002", source: "Walk-in", tags: [] });
    await sellMembership(admin, b.id, { planId: plan.id, startDate: addDays(today, -26), discount: 0, includeRegFee: true, payAmount: 0 });
    for (let i = 0; i < 8; i++) await db.attendance.create({ data: { branchId: gym.a.id, memberId: b.id, type: "MEMBER", date: fromIso(addDays(today, -40 - i)), checkIn: new Date(), method: "Manual", createdById: admin.id } });
    await computeRisk(gym.org.id, today);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const events = async (q: string) => {
    const out: ChatEvent[] = [];
    for await (const e of localChat(admin, q)) out.push(e);
    return out;
  };

  it("defaults are on/on/off; saving is persisted and audited", async () => {
    expect(await getAiSettings(gym.org.id)).toEqual({ enabled: true, dailyBrief: true, autoWinback: false });
    await putSetting(admin, "ai", { enabled: false });
    expect(await getAiSettings(gym.org.id)).toEqual({ enabled: false, dailyBrief: true, autoWinback: false });
    const log = await db.auditLog.findFirst({ where: { orgId: gym.org.id, action: "setting.update", entityId: "ai" }, orderBy: { createdAt: "desc" } });
    expect(log).toMatchObject({ entity: "Setting", before: null, after: { enabled: false } });
    await putSetting(admin, "ai", { enabled: true });
  });

  it("win-back drafts only when the switch is on", async () => {
    await putSetting(admin, "ai", { autoWinback: false });
    const risk = (await aiBrief(admin)).find((c) => c.icon === "risk")!;
    expect(risk.title).toMatch(/^1 members at risk/);
    expect(risk.action).toBeUndefined();
    const off = await events("which members are at risk");
    expect(off.some((e) => e.type === "proposal")).toBe(false);
    expect(off.map((e) => (e.type === "text" ? e.text : "")).join("")).toMatch(/Switch on win-back suggestions in Settings › Integrations & AI/);
    expect(await db.aiProposal.count({ where: { orgId: gym.org.id } })).toBe(0);

    await putSetting(admin, "ai", { autoWinback: true });
    expect((await aiBrief(admin)).find((c) => c.icon === "risk")!.action?.label).toBe("Review win-back messages");
    const on = await events("which members are at risk");
    expect(on.filter((e) => e.type === "proposal")).toHaveLength(1);
    expect(await db.aiProposal.count({ where: { orgId: gym.org.id } })).toBe(1);
    await putSetting(admin, "ai", { autoWinback: false });
  });

  it("the daily brief job writes one AI_BRIEF notification a day, and nothing when the assistant is off", async () => {
    const day = addDays(today, 1);
    const first = await runDailyJobs(gym.org.id, day);
    const brief = first.find((j) => j.name === "ai.brief")!;
    expect(brief.status).toBe("ran");
    expect(Number(brief.result?.alerts)).toBeGreaterThanOrEqual(1);
    expect(await db.notification.count({ where: { orgId: gym.org.id, type: "AI_BRIEF" } })).toBe(1);
    await runDailyJobs(gym.org.id, day);
    expect(await db.notification.count({ where: { orgId: gym.org.id, type: "AI_BRIEF" } })).toBe(1);

    await putSetting(admin, "ai", { enabled: false });
    const off = await runDailyJobs(gym.org.id, addDays(today, 2));
    expect(off.find((j) => j.name === "ai.brief")?.result).toEqual({ alerts: 0, note: "off" });
    expect(await db.notification.count({ where: { orgId: gym.org.id, type: "AI_BRIEF" } })).toBe(1);
    await putSetting(admin, "ai", { enabled: true });
  });

  it("the chat API refuses when the assistant is switched off", async () => {
    mockUser.current = admin;
    await putSetting(admin, "ai", { enabled: false });
    const res = await POST(new Request("http://localhost/api/ai/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Fitron AI is switched off in Settings › Integrations & AI." });
    await putSetting(admin, "ai", { enabled: true });
    mockUser.current = null;
  });

  it("Test connection: demo stores nothing, live without keys fails, live with keys pings Razorpay", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    expect(await getAutopaySettings(gym.org.id)).toEqual({ mode: "demo", retries: 3, retryGap: 2 });
    await checkAutopayConnection(admin);
    expect((await getAutopaySettings(gym.org.id)).connOk).toBeUndefined();

    await putSetting(admin, "autopay", { mode: "live", retries: 3, retryGap: 2 });
    let r = await checkAutopayConnection(admin);
    expect(r.connOk).toBe(false);
    expect(r.error).toMatch(/RAZORPAY_KEY_ID/);

    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "secret");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
    r = await checkAutopayConnection(admin);
    expect(calls[0]).toContain("/plans?count=1");
    expect(r).toMatchObject({ connOk: true, keyId: "rzp_test_abc", webhookOk: false });
    expect(r.checkedAt).toBeTruthy();
    const stored = await getAutopaySettings(gym.org.id);
    expect(stored).toMatchObject({ connOk: true, keyId: "rzp_test_abc", webhookOk: false, mode: "live" });
    expect(JSON.stringify(stored)).not.toContain("secret");
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "setting.update", entityId: "autopay" } })).toBeGreaterThanOrEqual(2);

    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "whs");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { description: "Authentication failed" } }), { status: 401 })));
    r = await checkAutopayConnection(admin);
    expect(r).toMatchObject({ connOk: false, error: "Authentication failed", webhookOk: true });
    await putSetting(admin, "autopay", { mode: "demo" });
  });
});
