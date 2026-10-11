import * as z from "zod";
import "@/lib/zod-config";
import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { aiReady } from "@/lib/integrations/ai";
import { chat, type ChatEvent } from "@/lib/services/ai";
import { localChat } from "@/lib/services/ai-local";
import { rateLimit } from "@/lib/rate-limit";
import { AI_OFF_MESSAGE, aiOn, getAiSettings } from "@/lib/services/ai-settings";
import { log } from "@/lib/log";
import { gymAccountingOnly, isLocal } from "@/lib/runtime/edition";
import { isNetworkError, probablyOnline, SERVICE } from "@/lib/integrations/online";

// Fitron AI chat. Streams newline-delimited JSON events: tool progress, text, proposals, done.
export const maxDuration = 120;

const body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]!.role === "user", "The last message must be the user's."),
});

const OFFLINE_NOTE = "This computer is offline, so Fitron AI is answering from the books on this computer. Full answers require an internet connection.";

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

  // FITRON for Windows sends a question and the figures it needs to Claude only once a gym user turned that on in
  // Settings › Integrations & AI; until then Fitron AI answers from the books on the computer, as without a key.
  const model = aiReady() && (!gymAccountingOnly() || (await getAiSettings(u.orgId)).useClaude);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (e: ChatEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      const question = parsed.data.messages.at(-1)!.content;
      // On a computer with no internet the model cannot be reached: answer from the books on this computer instead, and
      // say so, rather than waiting on a lookup that fails or showing "couldn't answer".
      const fromBooks = async () => {
        send({ type: "text", text: OFFLINE_NOTE });
        for await (const e of localChat(u, question)) send(e);
      };
      let answered = false;
      try {
        if (!model) {
          // Without a model key, answer from live data the way the prototype does offline.
          for await (const e of localChat(u, question)) send(e);
        } else if (isLocal() && !(await probablyOnline(SERVICE.anthropic))) {
          await fromBooks();
        } else {
          for await (const e of chat(u, parsed.data.messages)) {
            if (e.type === "text" || e.type === "proposal") answered = true;
            send(e);
          }
        }
      } catch (e) {
        if (isLocal() && !answered && isNetworkError(e)) {
          log.warn("ai_chat.offline", e);
          await fromBooks().catch((err) => {
            log.error("ai_chat.failed", err);
            send({ type: "error", message: "Fitron AI couldn't answer just now. Try again in a minute." });
          });
        } else {
          log.error("ai_chat.failed", e);
          send({ type: "error", message: isLocal() && isNetworkError(e) ? "Fitron AI lost the internet connection while answering. Try again when the computer is online." : "Fitron AI couldn't answer just now. Try again in a minute." });
        }
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
