import "server-only";

// Claude Messages API over fetch. The key stays on the server (ANTHROPIC_API_KEY).

export const aiReady = () => !!process.env.ANTHROPIC_API_KEY?.trim();
export const aiModel = () => process.env.AI_MODEL?.trim() || "claude-sonnet-5";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  // The model's own reasoning, which comes back on models that think by default; passed back unchanged with tool results.
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };
export type Msg = { role: "user" | "assistant"; content: string | Block[] };

export async function claude(req: { system: string; messages: Msg[]; tools: readonly object[]; maxTokens?: number; timeoutMs?: number }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: aiModel(), max_tokens: req.maxTokens ?? 2048, system: req.system, messages: req.messages, ...(req.tools.length ? { tools: req.tools } : {}) }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 90_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as { content: Block[]; stop_reason: string };
}

/** One plain reply, no tools (the AI Trainer coach). Returns the text, or "" if the model declined. */
export async function claudeText(req: { system: string; messages: { role: "user" | "assistant"; content: string }[]; maxTokens?: number; timeoutMs?: number }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!.trim(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: aiModel(), max_tokens: req.maxTokens ?? 1024, system: req.system, messages: req.messages }),
    signal: AbortSignal.timeout(req.timeoutMs ?? 20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
  }
  const out = (await res.json()) as { content: Block[]; stop_reason: string };
  if (out.stop_reason === "refusal") return "";
  return out.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("").trim();
}
