import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// Each test comes from its own address: the limiter is shared by the process.
let n = 0;
const post = (body: unknown, ip = `10.2.0.${++n}`, raw?: string) =>
  POST(new Request("http://x/api/assistant", { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }));
const ask = (text: string, ip?: string) => post({ messages: [{ role: "user", text }] }, ip);

let calls: { url: string; body: { system: string; messages: { role: string; content: string }[]; max_tokens: number } }[];
beforeEach(() => {
  calls = [];
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Claude answers `text` (or fails) for the next call. */
function claudeSays(reply: { text?: string; status?: number; stop?: string }) {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (reply.status) return new Response("overloaded", { status: reply.status });
      return Response.json({ content: [{ type: "text", text: reply.text ?? "" }], stop_reason: reply.stop ?? "end_turn" });
    }),
  );
}

describe("POST /api/assistant", () => {
  it("answers from the facts when there is no AI key, so the chat always works", async () => {
    const r = await ask("How much does it cost?");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const data = await r.json();
    expect(data.source).toBe("faq");
    expect(data.text).toContain("₹299");
    expect(data.text).toContain("₹1,999");
  });

  it("points to the team when it has no answer and no AI", async () => {
    const data = await (await ask("What is the capital of Australia?")).json();
    expect(data.source).toBe("faq");
    expect(data.text).toContain("62077 74673");
  });

  it("asks Claude with FITRON's facts and the conversation, and returns its words", async () => {
    claudeSays({ text: "AI Pro is ₹299 a month." });
    const r = await post({ messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "Hello!" }, { role: "user", text: "price of ai pro?" }] });
    expect(await r.json()).toEqual({ text: "AI Pro is ₹299 a month.", source: "ai" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    const sent = calls[0]!.body;
    expect(sent.system).toContain("Fitron Assistant");
    expect(sent.system).toContain("₹299");
    expect(sent.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(sent.messages.at(-1)!.content).toBe("price of ai pro?");
    expect(sent.max_tokens).toBeLessThanOrEqual(600);
  });

  it("never sends a long message or a long history to Claude", async () => {
    claudeSays({ text: "ok" });
    const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "m".repeat(1000) }));
    await post({ messages: [...history, { role: "user", text: "z".repeat(4000) }] });
    const sent = calls[0]!.body.messages;
    expect(sent.length).toBeLessThanOrEqual(8);
    expect(sent.at(-1)!.content.length).toBe(500);
  });

  it("falls back to the facts when Claude fails or declines, and does not log what the visitor typed", async () => {
    claudeSays({ status: 529 });
    const failed = await (await ask("how much is the trial?")).json();
    expect(failed.source).toBe("faq");
    expect(failed.text).toContain("7-day free trial");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("how much is the trial");

    claudeSays({ text: "", stop: "refusal" });
    expect((await (await ask("price?")).json()).source).toBe("faq");
  });

  it("limits each connection: a few messages a minute, then it asks them to wait", async () => {
    const ip = "10.9.9.9";
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await ask("price", ip)).status);
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(200));
    expect(statuses.slice(8)).toEqual([429, 429]);
    expect((await (await ask("price", ip)).json()).error).toContain("Wait a moment");
    expect((await ask("price")).status, "another visitor is not affected").toBe(200);
  });

  it("refuses what isn't a conversation", async () => {
    expect((await post(null, undefined, "not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ messages: [] })).status).toBe(400);
    expect((await post({ messages: [{ role: "assistant", text: "hi" }] })).status).toBe(400);
    expect((await post({ messages: [{ role: "user", text: "   " }] })).status).toBe(400);
    expect((await post({ messages: [{ role: "user", text: "x".repeat(5001) }] })).status).toBe(400);
  });

  it("refuses a body that is far too big without reading it all", async () => {
    const r = await post({ messages: [{ role: "user", text: "a" }], pad: "p".repeat(50_000) });
    expect(r.status).toBe(413);
  });
});
