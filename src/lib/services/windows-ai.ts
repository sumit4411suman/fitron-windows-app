import "server-only";
import { db } from "@/lib/db";
import { anthropicMessages, type Reply } from "@/lib/integrations/ai";
import { verifyLicence, type Licence } from "@/lib/licence/licence";
import { FITRON_LICENCE_KEYS } from "@/lib/licence/keys";
import { addDays } from "@/lib/domain/dates";
import { rateLimit } from "@/lib/rate-limit";
import { isLocal } from "@/lib/runtime/edition";
import { todayIso } from "./time";

// fitron.in answers Fitron AI's questions for FITRON for Windows computers that have a current licence (the gym bought
// it, src/lib/services/windows-licence.ts), with FITRON's own Anthropic key, which never leaves fitron.in. The
// computer runs the tools against its own database and sends what Claude needs (the question, the chat, the records
// looked up), only once a gym user ticked "Use Claude" there. fitron.in passes it to Claude and back, keeps nothing of
// it, and counts each licence's requests and tokens per day (WindowsAiUsage) to keep to a daily allowance.

/** Requests a licence may make a day: WINDOWS_AI_DAILY_LIMIT, 200 if unset. */
export const dailyLimit = (env: Record<string, string | undefined> = process.env) => {
  const n = Number(env.WINDOWS_AI_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 200;
};
/** Longest answer, in tokens, whatever the computer asks for. */
const MAX_TOKENS = 4096;

export type RelayOutcome = { ok: true; reply: Reply } | { ok: false; status: 400 | 401 | 403 | 429 | 503; error: string };

/** The licence in the request, when FITRON signed it, it is for one computer, and it is current today (with its grace days). */
export function currentLicence(text: string | null, today = todayIso()): { ok: true; licence: Licence } | { ok: false; status: 401 | 403; error: string } {
  if (!text) return { ok: false, status: 401, error: "No FITRON licence." };
  const v = verifyLicence(text, FITRON_LICENCE_KEYS);
  if (!v.ok) return { ok: false, status: 403, error: v.reason };
  if (!v.licence.installationId) return { ok: false, status: 403, error: "This licence is not for one computer." };
  if (today > addDays(v.licence.expiresOn, v.licence.graceDays)) return { ok: false, status: 403, error: "This licence has ended." };
  return { ok: true, licence: v.licence };
}

type Body = { system: string; messages: unknown[]; tools: unknown[]; maxTokens: number };

/** The request the computer sent, in the shape Claude takes; anything else is refused. */
export function relayBody(json: unknown): Body | null {
  if (!json || typeof json !== "object") return null;
  const b = json as Record<string, unknown>;
  if (typeof b.system !== "string" || b.system.length > 100_000) return null;
  if (!Array.isArray(b.messages) || b.messages.length < 1 || b.messages.length > 80) return null;
  if (b.tools !== undefined && (!Array.isArray(b.tools) || b.tools.length > 60)) return null;
  const asked = typeof b.max_tokens === "number" && Number.isInteger(b.max_tokens) && b.max_tokens > 0 ? b.max_tokens : 2048;
  return { system: b.system, messages: b.messages, tools: (b.tools as unknown[] | undefined) ?? [], maxTokens: Math.min(asked, MAX_TOKENS) };
}

/** One of the computer's Claude requests, answered with FITRON's key if its licence and today's allowance allow. */
export async function relayWindowsAi(licenceText: string | null, json: unknown, now = new Date()): Promise<RelayOutcome> {
  if (isLocal()) return { ok: false, status: 403, error: "fitron.in only." };
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return { ok: false, status: 503, error: "Fitron AI is not set up on fitron.in." };
  const today = todayIso(now);
  const lic = currentLicence(licenceText, today);
  if (!lic.ok) return lic;
  const body = relayBody(json);
  if (!body) return { ok: false, status: 400, error: "Bad request." };
  const licenceId = lic.licence.licenceId;
  if (!rateLimit(`windows-ai:${licenceId}`, 20, 60_000)) return { ok: false, status: 429, error: "Too many questions in a minute." };
  const used = await db.windowsAiUsage.upsert({ where: { licenceId_day: { licenceId, day: today } }, create: { licenceId, day: today, requests: 1 }, update: { requests: { increment: 1 } } });
  if (used.requests > dailyLimit()) return { ok: false, status: 429, error: "Today's allowance is used up." };
  const reply = await anthropicMessages({ system: body.system, messages: body.messages, tools: body.tools, maxTokens: body.maxTokens, timeoutMs: 100_000 });
  await db.windowsAiUsage.update({
    where: { id: used.id },
    data: { inputTokens: { increment: reply.usage?.input_tokens ?? 0 }, outputTokens: { increment: reply.usage?.output_tokens ?? 0 } },
  });
  return { ok: true, reply: { content: reply.content, stop_reason: reply.stop_reason } };
}
