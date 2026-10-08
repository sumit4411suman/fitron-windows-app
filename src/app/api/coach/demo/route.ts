import * as z from "zod";
import "@/lib/zod-config";
import { aiReady } from "@/lib/integrations/anthropic";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { demoCoachAnswer } from "@/lib/services/trainer-coach";
import { readCapped } from "../../trainer/_lib/http";

// The AI Coach live demo on the home page (public/site/coach-demo.html): POST { messages: [{ role, text }], profile } → { text }.
// The twin of /api/coach for visitors who have no account. The profile is the made-up member the demo is signed in as, and
// it only reaches the prompt through the coach's own list of fields. Open to anyone, so it is limited: per connection, and
// for the whole site so a crowd can't run up the AI bill. Without an answer (no ANTHROPIC_API_KEY, a limit, a failure) it
// says why with a status the demo understands (429, 503, 502) and the demo shows its built-in replies instead.
// Nothing a visitor types is saved or logged.
export const maxDuration = 30;

const PER_MINUTE = 6;
const PER_HOUR = 20;
const PER_DAY = 40;
const SITE_PER_HOUR = 300;

const schema = z.object({
  messages: z.array(z.object({ role: z.string().max(20), text: z.string().max(5000) })).min(1).max(40),
  profile: z.record(z.string(), z.unknown()).optional(),
});

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!aiReady()) return json({ error: "The live coach isn't switched on here." }, 503);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`coach-demo:${ip}`, PER_MINUTE, 60_000)) return json({ error: "That's a lot of messages in a minute. Wait a moment." }, 429);
  if (!rateLimit(`coach-demo-hour:${ip}`, PER_HOUR, 3_600_000) || !rateLimit(`coach-demo-day:${ip}`, PER_DAY, 86_400_000)) {
    return json({ error: "That's all the demo messages for now. Start your 7-day free trial to keep chatting with your own coach." }, 429);
  }
  if (!rateLimit("coach-demo:site", SITE_PER_HOUR, 3_600_000)) return json({ error: "The demo coach is busy right now." }, 503);
  const body = await readCapped(req, 40_000);
  if (body === null) return json({ error: "That message is too long." }, 413);
  let raw: unknown = null;
  try {
    raw = JSON.parse(body);
  } catch {}
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json({ error: "Bad request." }, 400);

  const turns = parsed.data.messages.map((t) => ({ role: t.role === "user" ? ("user" as const) : ("assistant" as const), text: t.text }));
  try {
    const text = await demoCoachAnswer(turns, parsed.data.profile ?? {});
    if (!text) return json({ error: "No reply." }, 502);
    return json({ text });
  } catch (e) {
    log.error("coach_demo.failed", e);
    return json({ error: "The coach couldn't answer just now." }, 502);
  }
}
