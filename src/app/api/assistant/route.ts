import * as z from "zod";
import "@/lib/zod-config";
import { answerFromFacts, assistantSystem, cleanTurns } from "@/lib/domain/assistant";
import { aiReady, claudeText } from "@/lib/integrations/anthropic";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { readCapped } from "../trainer/_lib/http";

// Fitron Assistant, the chat on the home page: POST { messages: [{ role, text }] } → { text, source }.
// Open to anyone, so it is limited: per connection, and for the whole site so a crowd can't run up the AI bill.
// `source` is "ai" when Claude worded the answer, "faq" when the best-matching fact was used (no ANTHROPIC_API_KEY, the AI
// is busy or failed, or the site-wide cap is reached): the chat always answers. Nothing a visitor types is saved.
export const maxDuration = 30;

const PER_MINUTE = 8;
const PER_HOUR = 60;
const SITE_PER_HOUR = 600;

const schema = z.object({
  messages: z.array(z.object({ role: z.string().max(20), text: z.string().max(5000) })).min(1).max(40),
});

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`assistant:${ip}`, PER_MINUTE, 60_000) || !rateLimit(`assistant-hour:${ip}`, PER_HOUR, 3_600_000)) {
    return json({ error: "That's a lot of messages. Wait a moment, or message the team on WhatsApp +91 62077 74673." }, 429);
  }
  const body = await readCapped(req, 40_000);
  if (body === null) return json({ error: "That message is too long." }, 413);
  let raw: unknown = null;
  try {
    raw = JSON.parse(body);
  } catch {}
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json({ error: "Bad request." }, 400);

  const turns = cleanTurns(parsed.data.messages);
  if (!turns.length) return json({ error: "Ask me a question." }, 400);

  if (aiReady() && rateLimit("assistant:site", SITE_PER_HOUR, 3_600_000)) {
    try {
      const text = await claudeText({ system: assistantSystem(), messages: turns.map((t) => ({ role: t.role, content: t.text })), maxTokens: 450, timeoutMs: 20_000 });
      if (text) return json({ text, source: "ai" });
    } catch (e) {
      log.error("assistant.failed", e);
    }
  }
  return json({ text: answerFromFacts(turns.at(-1)!.text).text, source: "faq" });
}
