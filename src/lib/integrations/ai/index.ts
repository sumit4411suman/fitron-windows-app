import "server-only";
import { isLocal } from "@/lib/runtime/edition";
import { relayLicence } from "@/lib/licence";
import { UserError } from "@/lib/services/errors";
import { cloudUrl } from "../sync";
import { SERVICE } from "../online";

// Claude Messages API over fetch. The key stays on the server (ANTHROPIC_API_KEY).
//
// FITRON for Windows has no key of its own: with a bought licence (src/lib/licence) it asks through fitron.in, which
// checks the licence and answers with FITRON's key (src/lib/services/windows-ai.ts). The tools still run on the
// computer, against its own database; only the question, the chat and the records looked up go out, and only once a gym
// user ticked "Use Claude" in Settings › Integrations & AI (src/app/api/ai/chat/route.ts).

const directKey = () => process.env.ANTHROPIC_API_KEY?.trim() || "";
/** FITRON for Windows with a current licence and no key of its own: the licence that fitron.in answers for. */
export const aiRelay = () => (!directKey() && isLocal() ? relayLicence() : null);
export const aiReady = () => !!directKey() || !!aiRelay();
export const aiModel = () => process.env.AI_MODEL?.trim() || "claude-sonnet-5";
/** Where the model is reached from here, to check the internet before asking. */
export function aiService(): { host: string; port: number } {
  if (directKey() || !isLocal()) return SERVICE.anthropic;
  const u = new URL(cloudUrl());
  return { host: u.hostname, port: Number(u.port || (u.protocol === "http:" ? 80 : 443)) };
}

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
export type Reply = { content: Block[]; stop_reason: string; usage?: { input_tokens?: number; output_tokens?: number } };

/** One request to Anthropic with this server's key: the model is always this server's. */
export async function anthropicMessages(req: { system: string; messages: unknown[]; tools?: readonly unknown[]; maxTokens: number; timeoutMs: number }): Promise<Reply> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": directKey(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: aiModel(), max_tokens: req.maxTokens, system: req.system, messages: req.messages, ...(req.tools?.length ? { tools: req.tools } : {}) }),
    signal: AbortSignal.timeout(req.timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as Reply;
}

/** What fitron.in's refusals mean for the person asking on the computer. */
function relayRefusal(status: number): Error {
  if (status === 401 || status === 403) return new UserError("Fitron AI's full answers need a current FITRON licence for this computer (Settings › Licence). Meanwhile it answers from the books when Use Claude is off.");
  if (status === 429) return new UserError("Fitron AI has answered a lot of questions for this gym today. Its full answers come back tomorrow; turn off Use Claude to keep asking from the books.");
  if (status === 503) return new UserError("Fitron AI's full answers aren't available from fitron.in just now. Try again later, or turn off Use Claude to ask from the books.");
  return new Error(`fitron.in AI relay ${status}`);
}

export async function claude(req: { system: string; messages: Msg[]; tools: readonly object[]; maxTokens?: number; timeoutMs?: number }): Promise<Reply> {
  const maxTokens = req.maxTokens ?? 2048;
  const timeoutMs = req.timeoutMs ?? 90_000;
  const licence = aiRelay();
  if (!licence) return anthropicMessages({ system: req.system, messages: req.messages, tools: req.tools, maxTokens, timeoutMs });
  const res = await fetch(`${cloudUrl()}/api/windows-ai/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fitron-licence": licence },
    body: JSON.stringify({ system: req.system, messages: req.messages, tools: req.tools, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(timeoutMs + 10_000),
  });
  if (!res.ok) throw relayRefusal(res.status);
  return (await res.json()) as Reply;
}

/** One plain reply, no tools (the AI Trainer coach). Returns the text, or "" if the model declined. */
export async function claudeText(req: { system: string; messages: { role: "user" | "assistant"; content: string }[]; maxTokens?: number; timeoutMs?: number }) {
  const out = await anthropicMessages({ system: req.system, messages: req.messages, maxTokens: req.maxTokens ?? 1024, timeoutMs: req.timeoutMs ?? 20_000 });
  if (out.stop_reason === "refusal") return "";
  return out.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("").trim();
}
