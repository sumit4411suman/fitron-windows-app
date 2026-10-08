import * as z from "zod";
import "@/lib/zod-config";
import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { aiReady } from "@/lib/integrations/anthropic";
import { chat, type ChatEvent } from "@/lib/services/ai";
import { localChat } from "@/lib/services/ai-local";
import { rateLimit } from "@/lib/rate-limit";
import { AI_OFF_MESSAGE, aiOn } from "@/lib/services/ai-settings";
import { log } from "@/lib/log";

// Fitron AI chat. Streams newline-delimited JSON events: tool progress, text, proposals, done.
export const maxDuration = 120;

const body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]!.role === "user", "The last message must be the user's."),
});

export async function POST(req: Request) {
  const u = await getCurrentUser();
  if (!u) return Response.json({ error: "Sign in again." }, { status: 401 });
  if (u.planBlocked) return Response.json({ error: PLAN_ENDED }, { status: 402 });
  if (!u.has("ai")) return Response.json({ error: "Fitron AI is on the Professional plan. A Super Admin can upgrade in Settings › Plan & billing." }, { status: 402 });
  if (!u.can("ai.use")) return Response.json({ error: "Your role doesn't include Fitron AI." }, { status: 403 });
  if (!(await aiOn(u.orgId))) return Response.json({ error: AI_OFF_MESSAGE }, { status: 403 });
  if (!rateLimit(`ai:${u.id}`, 15, 60_000)) return Response.json({ error: "That's a lot of questions in a minute. Wait a moment and try again." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (e: ChatEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        // Without a model key, answer from live data the way the prototype does offline.
        const events = aiReady() ? chat(u, parsed.data.messages) : localChat(u, parsed.data.messages.at(-1)!.content);
        for await (const e of events) send(e);
      } catch (e) {
        log.error("ai_chat.failed", e);
        send({ type: "error", message: "Fitron AI couldn't answer just now. Try again in a minute." });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
