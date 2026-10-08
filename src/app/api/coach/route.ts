import * as z from "zod";
import "@/lib/zod-config";
import { aiReady } from "@/lib/integrations/anthropic";
import { rateLimit } from "@/lib/rate-limit";
import { refundCoachMessage, takeCoachMessage } from "@/lib/services/trainer";
import { coachAnswer } from "@/lib/services/trainer-coach";
import { currentTrainer } from "@/lib/services/trainer-session";
import { readCapped } from "../trainer/_lib/http";
import { log } from "@/lib/log";

// The AI Trainer app's coach: POST { messages: [{ role, text }], profile } → { text }.
// 503 without ANTHROPIC_API_KEY and 429 over the plan's daily limit; the app then uses its built-in replies.
export const maxDuration = 30;

const schema = z.object({
  messages: z.array(z.object({ role: z.string(), text: z.string().max(8000) })).min(1).max(40),
  profile: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  const m = await currentTrainer();
  if (!m) return Response.json({ error: "Sign in again." }, { status: 401 });
  if (!aiReady()) return Response.json({ error: "The coach isn't switched on yet. The server needs an ANTHROPIC_API_KEY." }, { status: 503 });
  // Per member, and per connection so many trial accounts on one phone can't share out the cost.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`coach:${m.id}`, 10, 60_000) || !rateLimit(`coach-ip:${ip}`, 30, 60_000)) return Response.json({ error: "That's a lot of messages in a minute. Wait a moment." }, { status: 429 });
  const text = await readCapped(req, 600_000);
  if (text === null) return Response.json({ error: "That message is too long." }, { status: 413 });
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {}
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400 });

  const quota = await takeCoachMessage(m);
  if (!quota.ok) {
    const error = quota.reason === "LOCKED" ? "Start your free trial or pick a plan to use the coach." : `You've used today's ${quota.limit} coach messages. They reset at midnight${m.plan === "ai-pro" ? ", or move to AI Premium for more" : ""}.`;
    return Response.json({ error, limit: quota.limit }, { status: 429 });
  }
  const turns = parsed.data.messages.map((t) => ({ role: t.role === "user" ? ("user" as const) : ("assistant" as const), text: t.text }));
  try {
    const text = await coachAnswer(m, turns, parsed.data.profile ?? {});
    if (!text) {
      await refundCoachMessage(m.id);
      return Response.json({ error: "No reply." }, { status: 502 });
    }
    return Response.json({ text, used: quota.used, limit: quota.limit });
  } catch (e) {
    log.error("coach.failed", e);
    await refundCoachMessage(m.id);
    return Response.json({ error: "The coach couldn't answer just now." }, { status: 502 });
  }
}
