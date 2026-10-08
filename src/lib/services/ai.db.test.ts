import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { computeRisk, dailyBrief } from "./insights";
import { runTool } from "./ai-tools";
import { chat, confirmProposal, type ChatEvent } from "./ai";
import { fromIso, todayIso } from "./time";
import { putSetting } from "./settings";

describe.skipIf(!hasDb)("Fitron AI (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let regular: string;
  let lapsing: string;
  const today = todayIso();

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const a = await createMember(admin, { name: "Regular Rita", gender: "Female", phone: "9844400001", source: "Walk-in", tags: [] });
    const b = await createMember(admin, { name: "Lapsing Lalit", gender: "Male", phone: "9844400002", source: "Walk-in", tags: [] });
    regular = a.id;
    lapsing = b.id;
    await sellMembership(admin, a.id, { planId: plan.id, startDate: addDays(today, -10), discount: 0, includeRegFee: true, payAmount: 150000, payMethod: "Cash" as const });
    await sellMembership(admin, b.id, { planId: plan.id, startDate: addDays(today, -26), discount: 0, includeRegFee: true, payAmount: 0 });
    for (let i = 0; i < 8; i++) {
      await db.attendance.create({ data: { branchId: gym.a.id, memberId: regular, type: "MEMBER", date: fromIso(addDays(today, -i)), checkIn: new Date(), method: "Manual", createdById: admin.id } });
      await db.attendance.create({ data: { branchId: gym.a.id, memberId: lapsing, type: "MEMBER", date: fromIso(addDays(today, -40 - i)), checkIn: new Date(), method: "Manual", createdById: admin.id } });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("scores a member who stopped coming, is about to expire and owes money as high risk", async () => {
    await computeRisk(gym.org.id, today);
    const [r, l] = await Promise.all([db.member.findUniqueOrThrow({ where: { id: regular } }), db.member.findUniqueOrThrow({ where: { id: lapsing } })]);
    expect(r.riskScore).toBeLessThan(35);
    expect(l.riskScore).toBeGreaterThanOrEqual(60);
    expect(l.riskReasons.join(" ")).toMatch(/Last visit 40 days ago/);
    expect((await dailyBrief(admin)).some((a) => /high risk/.test(a.title))).toBe(true);
  });

  it("tools respect the caller's role", async () => {
    const trainer = pick(await gym.user("Trainer"), gym.a.id);
    expect(await runTool(trainer, "revenue_breakdown", { from: today, to: today })).toEqual({ error: "This staff member can't see accounts." });
    const desk = pick(await gym.user("Receptionist"), gym.a.id);
    const dues = (await runTool(desk, "list_members", { filter: "dues" })) as { count: number; members: { name: string }[] };
    expect(dues.members.map((m) => m.name)).toEqual(["Lapsing Lalit"]);
    expect(await runTool(trainer, "propose_action", { message: "Hi", summary: "x", member_ids: [lapsing] })).toEqual({ error: "This staff member can't send WhatsApp messages." });
  });

  it("runs Claude's tool calls, surfaces a proposal, and sends only when confirmed, once", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const replies = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "list_members", input: { filter: "dues" } }] },
      { stop_reason: "tool_use", content: [{ type: "text", text: "Lalit owes ₹1,500." }, { type: "tool_use", id: "t2", name: "propose_action", input: { member_ids: [lapsing], message: "Hi {{member_name}}, your dues are pending.", summary: "Remind 1 member with dues" } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Check the message and press Send." }] },
    ];
    const sent: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(replies.shift()), { status: 200 });
      }),
    );
    const events: ChatEvent[] = [];
    for await (const e of chat(admin, [{ role: "user", content: "Who owes money? Remind them." }])) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["tool", "text", "tool", "proposal", "text", "done"]);
    // The tool result went back to Claude.
    expect(JSON.stringify(sent[1])).toContain("Lapsing Lalit");
    const proposal = events.find((e) => e.type === "proposal") as Extract<ChatEvent, { type: "proposal" }>;
    expect(proposal.members).toBe(1);
    expect(await db.whatsAppMessage.count({ where: { memberId: lapsing } })).toBe(0);

    vi.unstubAllGlobals();
    const r = await confirmProposal(admin, proposal.id);
    expect((r as { sent: number }).sent).toBe(1);
    expect(await db.whatsAppMessage.count({ where: { memberId: lapsing, templateKey: "campaign" } })).toBe(1);
    await expect(confirmProposal(admin, proposal.id)).rejects.toThrow(/Already handled/);
    const other = pick(await gym.user("Admin"), gym.a.id);
    await expect(confirmProposal(other, proposal.id)).rejects.toThrow(/not found/);
  });

  /** Claude answers with each of `replies` in turn; returns what was sent to it. */
  function claudeReplies(replies: unknown[]) {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const sent: { max_tokens: number }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(replies.shift()), { status: 200 });
      }),
    );
    return sent;
  }
  const turn = async (q: string) => {
    const events: ChatEvent[] = [];
    for await (const e of chat(admin, [{ role: "user", content: q }])) events.push(e);
    return events;
  };
  const texts = (events: ChatEvent[]) => events.flatMap((e) => (e.type === "text" ? [e.text] : []));

  const whatsappDraft = (body: string) =>
    db.aiProposal.create({ data: { orgId: admin.orgId, userId: admin.id, kind: "WHATSAPP", summary: "Remind 1 member", memberIds: [lapsing], body } });

  it("does not confirm drafts once Fitron AI is switched off", async () => {
    const p = await whatsappDraft("Hi {{member_name}}, a reminder.");
    await putSetting(admin, "ai", { enabled: false });
    try {
      await expect(confirmProposal(admin, p.id)).rejects.toThrow(/switched off/);
      expect((await db.aiProposal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PENDING");
    } finally {
      await putSetting(admin, "ai", { enabled: true });
    }
  });

  it("lets a WhatsApp suggestion be sent again when a check stopped it before anything went out", async () => {
    const p = await whatsappDraft("   ");
    await expect(confirmProposal(admin, p.id)).rejects.toThrow(/Write the message first/);
    expect((await db.aiProposal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PENDING");
  });

  it("leaves room to think and answer, and never ends a turn without saying something", async () => {
    // Thought, then stopped with nothing to say.
    const sent = claudeReplies([{ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "s" }] }]);
    const events = await turn("How are we doing?");
    expect(sent[0]!.max_tokens).toBeGreaterThanOrEqual(4096);
    expect(texts(events)).toEqual([expect.stringContaining("couldn't put an answer together")]);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("does not run a tool call that was cut off, and keeps what it wrote", async () => {
    claudeReplies([{ stop_reason: "max_tokens", content: [{ type: "text", text: "Here is the summary" }, { type: "tool_use", id: "t", name: "list_members", input: {} }] }]);
    const events = await turn("Everything about everyone");
    expect(events.map((e) => e.type)).toEqual(["text", "done"]);
    expect(texts(events)).toEqual(["Here is the summary"]);

    claudeReplies([{ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "", signature: "s" }] }]);
    expect(texts(await turn("Everything"))).toEqual([expect.stringContaining("ran too long")]);
  });

  it("says so when the model declines", async () => {
    claudeReplies([{ stop_reason: "refusal", content: [] }]);
    expect(texts(await turn("something odd"))).toEqual([expect.stringContaining("can't help with that one")]);
  });

  it("stops before the route's time limit instead of being cut off without a word", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      claudeReplies([{ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "list_members", input: { filter: "dues" } }] }]);
      const events: ChatEvent[] = [];
      for await (const e of chat(admin, [{ role: "user", content: "Who owes money?" }])) {
        events.push(e);
        if (e.type === "tool") vi.setSystemTime(Date.now() + 95_000);
      }
      expect(events.map((e) => e.type)).toEqual(["tool", "text", "done"]);
      expect(texts(events)).toEqual([expect.stringContaining("took longer than I can spend")]);
    } finally {
      vi.useRealTimers();
    }
  });
});
