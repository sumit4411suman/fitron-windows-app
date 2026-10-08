import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createInvoice } from "./billing";
import { aiBrief, localChat } from "./ai-local";
import type { ChatEvent } from "./ai";
import { todayIso } from "./time";

const run = async (gen: AsyncGenerator<ChatEvent>) => {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};

describe.skipIf(!hasDb)("Fitron AI without a model (database)", () => {
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let owingId: string;
  const today = todayIso();

  beforeAll(async () => {
    const gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const m = await createMember(admin, { name: "Dues Member", gender: "Male", phone: "9877700001", source: "Walk-in", tags: [] });
    owingId = m.id;
    await createInvoice(admin, { memberId: m.id, date: today, dueDate: today, lines: [{ description: "PT", category: "Personal Training", qty: 1, rate: 100000, discount: 0, taxable: true }], payAmount: 0 });
    const r = await createMember(admin, { name: "Risky Member", gender: "Female", phone: "9877700002", source: "Walk-in", tags: [] });
    await db.member.update({ where: { id: r.id }, data: { riskScore: 80, riskReasons: ["No visits recorded"] } });
  });

  it("answers about dues and drafts a reminder that waits for Send", async () => {
    const ev = await run(localChat(admin, "Draft reminders for pending dues"));
    const text = ev.find((e) => e.type === "text");
    expect(text && "text" in text && text.text).toMatch(/₹1,180 is outstanding across 1 members/);
    const p = ev.find((e) => e.type === "proposal");
    expect(p).toBeDefined();
    const row = await db.aiProposal.findUniqueOrThrow({ where: { id: (p as { id: string }).id } });
    expect(row).toMatchObject({ status: "PENDING", memberIds: [owingId] });
  });

  it("lists members at risk with their reasons", async () => {
    const ev = await run(localChat(admin, "Which members are at risk?"));
    const text = ev.find((e) => e.type === "text") as { text: string };
    expect(text.text).toContain("Risky Member");
    expect(text.text).toContain("no visits recorded");
  });

  it("falls back to today's overview, and the brief counts the same things", async () => {
    const ev = await run(localChat(admin, "hello"));
    expect((ev.find((e) => e.type === "text") as { text: string }).text).toMatch(/₹1,180 outstanding and 1 members at risk/);
    const brief = await aiBrief(admin);
    expect(brief.find((b) => b.icon === "risk")?.title).toBe("1 members at risk of not renewing");
    expect(brief.find((b) => b.icon === "money")?.title).toBe("₹1,180 to collect");
  });

  it("still gives the rest of the brief when one card's numbers can't be read", async () => {
    // As on the live site: one query failing used to take the whole Fitron AI page down.
    const spy = vi.spyOn(db.member, "findMany").mockRejectedValueOnce(new Error("relation does not exist"));
    try {
      const brief = await aiBrief(admin);
      expect(brief.find((b) => b.icon === "risk")).toBeUndefined();
      expect(brief.find((b) => b.icon === "money")?.title).toBe("₹1,180 to collect");
      expect(brief.find((b) => b.icon === "trend")).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  const say = async (q: string, u = admin) => ((await run(localChat(u, q))).find((e) => e.type === "text") as { text: string }).text;

  it("answers accounting questions from the books", async () => {
    const monthStart = `${today.slice(0, 7)}-01`;
    expect(await say("How much GST did we collect this month?")).toMatch(new RegExp(`GST on sales, ${monthStart} to ${today}:[\\s\\S]*Taxable value: ₹1,000[\\s\\S]*CGST ₹90 · SGST ₹90 · IGST ₹0[\\s\\S]*Total GST: ₹180 on 1 invoices`));
    expect(await say("Which invoices are overdue or unpaid?")).toMatch(/₹1,180 is outstanding on 1 open invoices/);
    expect(await say("Show expenses this month")).toMatch(/Expenses .* to .*: ₹0 operating/);
    expect(await say("What is my cash balance?")).toMatch(/Money on hand today: ₹/);
    const inv = await db.invoice.findFirstOrThrow({ where: { member: { name: "Dues Member" } } });
    expect(await say(`Show invoice ${inv.number}`)).toContain(`${inv.number} for Dues Member: total ₹1,180, paid ₹0, balance ₹1,180`);
  });

  it("explains accounting and GST concepts from what it knows", async () => {
    expect(await say("What is the GST rate for a gym?")).toContain("SAC 999723");
    expect(await say("When is GSTR-3B due?")).toContain("20th");
    expect(await say("How does depreciation work?")).toContain("fixed-asset register");
  });

  it("says what it can do, and that drafting an invoice needs the model", async () => {
    expect(await say("What can you do?")).toContain("Read and explain");
    const t = await say("Create an invoice for Dues Member for 2 PT sessions");
    expect(t).toContain("needs the AI model");
    expect(t).toContain("Invoices › New invoice");
    expect(await db.aiProposal.count({ where: { userId: admin.id, kind: "INVOICE" } })).toBe(0);
  });

  it("keeps accounts from people whose role can't see them", async () => {
    const gym = await makeGym();
    const trainer = pick(await gym.user("Trainer"), gym.a.id);
    for (const q of ["How much GST did we collect this month?", "Which invoices are overdue?", "Show expenses this month", "What is my cash balance?", "Any supplier bills due?"]) {
      expect(await say(q, trainer), q).toMatch(/^Your role doesn't include/);
    }
  });
});

