import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";
import { POST } from "@/app/api/ai/chat/route";
import { GET as listRoute } from "@/app/api/ai/chats/route";
import { DELETE as deleteRoute, GET as getRoute } from "@/app/api/ai/chats/[id]/route";
import { chatHistory, chatTitle, deleteChat, draftStatusNote, getChat, historyMessages, listChats, saveTurn, chatFor } from "./ai-chats";

const mockUser = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/current", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/current")>()), getCurrentUser: async () => mockUser.current }));

const ask = (body: unknown) => POST(new Request("http://localhost/api/ai/chat", { method: "POST", body: JSON.stringify(body) }));
const events = async (res: Response) =>
  (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; id?: string; text?: string; message?: string });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as RouteContext<"/api/ai/chats/[id]">;

describe.skipIf(!hasDb)("Fitron AI chat history (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let owner: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let other: typeof owner;

  beforeAll(async () => {
    gym = await makeGym();
    owner = await gym.user("Super Admin");
    other = await gym.user("Super Admin");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mockUser.current = null;
  });

  it("titles a chat after its first question, or its files", () => {
    expect(chatTitle("  How much   is due\nthis month? ")).toBe("How much is due this month?");
    expect(chatTitle("", [{ name: "bill.pdf", kind: "pdf" }])).toBe("File: bill.pdf");
    expect(chatTitle("x".repeat(80))).toHaveLength(58);
  });

  it("keeps each person's chats to themselves, and deletes them", async () => {
    const c = await chatFor(owner, undefined, "Who owes fees?", []);
    await saveTurn(c.id, { role: "user", content: "Who owes fees?" });
    await saveTurn(c.id, { role: "assistant", content: "Asha owes ₹1,180.", proposals: [{ type: "proposal", id: "missing-proposal", kind: "expense", title: "Rent", lines: [] } as never] });
    expect((await listChats(owner)).map((x) => x.id)).toContain(c.id);
    expect((await listChats(other)).map((x) => x.id)).not.toContain(c.id);
    const got = await getChat(owner, c.id);
    expect(got.turns.map((t) => [t.role, t.content])).toEqual([
      ["user", "Who owes fees?"],
      ["assistant", "Asha owes ₹1,180."],
    ]);
    // A draft whose record is gone reads as dismissed, so it can't be confirmed from history.
    expect(got.turns[1]!.proposals![0]!.status).toBe("DISMISSED");
    await expect(getChat(other, c.id)).rejects.toThrow(/not found/);
    await expect(deleteChat(other, c.id)).rejects.toThrow(/not found/);
    await expect(chatFor(other, c.id, "x", [])).rejects.toThrow(/not found/);
    await deleteChat(owner, c.id);
    expect(await db.aiChatMessage.count({ where: { chatId: c.id } })).toBe(0);
    await expect(getChat(owner, c.id)).rejects.toThrow(/not found/);
  });

  it("the chat API saves both sides of the conversation into the chat it names", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    mockUser.current = owner;
    const first = await events(await ask({ messages: [{ role: "user", content: "How many members are active?" }] }));
    const id = first[0]!.id!;
    expect(first[0]).toMatchObject({ type: "chat", title: "How many members are active?" });
    expect(first.some((e) => e.type === "text")).toBe(true);
    const again = await events(await ask({ chatId: id, messages: [{ role: "user", content: "How many members are active?" }, { role: "assistant", content: "…" }, { role: "user", content: "And expired?" }] }));
    expect(again[0]).toMatchObject({ type: "chat", id });
    const saved = await getChat(owner, id);
    expect(saved.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(saved.turns[2]!.content).toBe("And expired?");

    const list = await listRoute();
    expect(((await list.json()) as { chats: { id: string }[] }).chats[0]!.id).toBe(id);
    expect((await getRoute(new Request("http://localhost"), ctx(id))).status).toBe(200);

    // Someone else can't read, add to or delete it.
    mockUser.current = other;
    expect((await getRoute(new Request("http://localhost"), ctx(id))).status).toBe(404);
    expect((await deleteRoute(new Request("http://localhost"), ctx(id))).status).toBe(404);
    expect((await ask({ chatId: id, messages: [{ role: "user", content: "hi" }] })).status).toBe(404);

    mockUser.current = owner;
    expect((await deleteRoute(new Request("http://localhost"), ctx(id))).status).toBe(200);
    expect((await getRoute(new Request("http://localhost"), ctx(id))).status).toBe(404);
  });

  it("sends attached files to the model with the question and keeps only their names", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    mockUser.current = owner;
    const sent: { messages: { role: string; content: unknown }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)));
        return Response.json({ content: [{ type: "text", text: "The bill is for ₹4,500 of cleaning supplies." }], stop_reason: "end_turn" });
      }),
    );
    const out = await events(
      await ask({
        messages: [{ role: "user", content: "" }],
        attachments: [
          { name: "bill.pdf", type: "application/pdf", data: "JVBERi0=" },
          { name: "list.csv", type: "text/csv", data: Buffer.from("item,amount\nMops,4500").toString("base64") },
        ],
      }),
    );
    expect(out.find((e) => e.type === "text")?.text).toContain("₹4,500");
    const last = sent[0]!.messages.at(-1)!.content as { type: string; text?: string }[];
    expect(last.map((b) => b.type)).toEqual(["document", "text", "text"]);
    expect(last[1]!.text).toContain("Mops,4500");
    expect(last[2]!.text).toMatch(/Read the attached file/);

    const saved = await getChat(owner, out[0]!.id!);
    expect(saved.title).toBe("File: bill.pdf, list.csv");
    expect(saved.turns[0]!.attachments).toEqual([
      { name: "bill.pdf", kind: "pdf" },
      { name: "list.csv", kind: "text" },
    ]);
    // The row keeps the text read from the CSV (for later questions) but never a file's bytes.
    const row = await db.aiChatMessage.findFirstOrThrow({ where: { chatId: out[0]!.id! } });
    expect(JSON.stringify(row)).not.toContain("JVBERi0=");
    expect(row.attachments).toEqual([
      { name: "bill.pdf", kind: "pdf" },
      { name: "list.csv", kind: "text", text: expect.stringContaining("Mops,4500") },
    ]);

    // The next question in the chat: the model gets the earlier turns from the saved chat, with the file's text, so it
    // does not "forget" the bill.
    const again = await events(await ask({ chatId: out[0]!.id!, messages: [{ role: "user", content: "How much was it again?" }] }));
    expect(again[0]).toMatchObject({ type: "chat", id: out[0]!.id! });
    const history = sent[1]!.messages;
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(history[0]!.content).toContain('The PDF "bill.pdf" was attached to this message and you read it then');
    expect(history[0]!.content).toContain("Mops,4500");
    expect(history[0]!.content).not.toContain("JVBERi0=");
    expect(history[1]!.content).toBe("The bill is for ₹4,500 of cleaning supplies.");
    expect(history[2]!.content).toBe("How much was it again?");
  });

  it("tells the model what became of each draft it offered, so a discarded one is never treated as saved", async () => {
    const c = await chatFor(owner, undefined, "Record the rent", []);
    const mk = (summary: string, status: string, result: string | null) => db.aiProposal.create({ data: { orgId: gym.org.id, userId: owner.id, kind: "EXPENSE", memberIds: [], body: "Expense: rent", summary, status, result } });
    const [open, done, dropped, failed, retired] = await Promise.all([
      mk("Record expense: Rent", "PENDING", null),
      mk("Record expense: Water", "DONE", "Expense EXP-7 of ₹500.00 recorded."),
      mk("Record expense: Chai", "DISMISSED", null),
      mk("Record expense: Paint", "PENDING", "Not saved: 2026-08 is locked for this branch."),
      mk("Record expense: Gas", "DISMISSED", 'No longer available: "Record expense: Gas" was confirmed instead.'),
    ]);
    const proposal = (p: { id: string; summary: string }) => ({ type: "proposal" as const, id: p.id, kind: "EXPENSE", summary: p.summary, members: 0, body: "…", confirm: "Record expense" });
    await saveTurn(c.id, { role: "user", content: "Record the rent" });
    await saveTurn(c.id, { role: "assistant", content: "Ready on the card.", proposals: [proposal(open), proposal(done), proposal(dropped), proposal(failed), proposal(retired)] });
    await saveTurn(c.id, { role: "user", content: "Did it go through?" });
    await saveTurn(c.id, { role: "assistant", content: "", error: "Fitron AI couldn't answer just now." });
    const history = await chatHistory(owner, c.id);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const notes = String(history[1]!.content);
    expect(notes.startsWith("Ready on the card.")).toBe(true);
    expect(notes).toContain('[Draft "Record expense: Rent": still waiting for the user\'s decision on its card ("Record expense" or Discard); nothing is saved yet.]');
    expect(notes).toContain('[Draft "Record expense: Water": the user confirmed it and it was saved (Expense EXP-7 of ₹500.00 recorded.).]');
    expect(notes).toContain('[Draft "Record expense: Chai": the user discarded it (or it expired), so it was never saved. If they ask for it again, make a fresh draft with the tool.]');
    expect(notes).toContain('[Draft "Record expense: Paint": the user pressed "Record expense" but it failed a check, so nothing was saved: 2026-08 is locked for this branch. The card is still open.]');
    expect(notes).toContain('[Draft "Record expense: Gas": its card was retired because another card for the same action was confirmed; this one was not saved.]');
    // Someone else's chat gives nothing; a draft whose record is gone reads as discarded.
    expect(await chatHistory(other, c.id)).toEqual([]);
    expect(draftStatusNote({ ...proposal({ id: "gone", summary: "Record expense: Lost" }), status: "DISMISSED", result: null })).toContain("discarded it");
    // Turns of one side in a row are joined, and failed turns are skipped.
    expect(historyMessages([{ role: "user", content: "a" }, { role: "user", content: "b", attachments: [{ name: "x.csv", kind: "text", text: "1,2" }] }, { role: "assistant", content: "", error: "x" }])).toEqual([{ role: "user", content: "a\n\n1,2\n\nb" }]);
  });

  it("refuses files it can't read, too many files, too much, and an empty question", async () => {
    mockUser.current = owner;
    const before = await db.aiChat.count({ where: { userId: owner.id } });
    let res = await ask({ messages: [{ role: "user", content: "read" }], attachments: [{ name: "old.xls", type: "", data: "AAAA" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/save it as \.xlsx/);
    res = await ask({ messages: [{ role: "user", content: "read" }], attachments: Array.from({ length: 4 }, (_, i) => ({ name: `${i}.pdf`, type: "application/pdf", data: "JVBERi0=" })) });
    expect(res.status).toBe(400);
    res = await ask({ messages: [{ role: "user", content: "read" }], attachments: [{ name: "big.pdf", type: "application/pdf", data: "A".repeat(4_100_000) }] });
    expect(res.status).toBe(413);
    res = await ask({ messages: [{ role: "user", content: "   " }] });
    expect(res.status).toBe(400);
    expect(await db.aiChat.count({ where: { userId: owner.id } })).toBe(before);
  });
});
