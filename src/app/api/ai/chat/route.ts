import * as z from "zod";
import "@/lib/zod-config";
import { aiReady, aiService, type Block, type Msg } from "@/lib/integrations/ai";
import { chat, type ChatEvent, type ProposalEvent } from "@/lib/services/ai";
import { localChat } from "@/lib/services/ai-local";
import { rateLimit } from "@/lib/rate-limit";
import { getAiSettings } from "@/lib/services/ai-settings";
import { log } from "@/lib/log";
import { UserError } from "@/lib/services/errors";
import { ATTACHMENT_TEXT_CAP, chatFor, chatHistory, saveTurn, type ChatAttachment } from "@/lib/services/ai-chats";
import { AttachmentError, attachmentBlocks, attachmentRecord, kindOf } from "@/lib/files/read-attachment";
import { gymAccountingOnly, isLocal } from "@/lib/runtime/edition";
import { isNetworkError, probablyOnline } from "@/lib/integrations/online";
import { readCapped } from "../../trainer/_lib/http";
import { aiUser } from "../_lib/access";

// Fitron AI chat. Streams newline-delimited JSON events: the chat it is saved in, tool progress, text, proposals, done.
// A question can bring up to three files (PDF, photo, Excel, Word, CSV). Their bytes are read for this answer only and
// never stored; the chat keeps their names and the text read from a CSV, Excel or Word file, so a later question can
// still refer to it. The model's history is the chat as saved here (with each draft's current state), not what the
// browser sends: the browser's copy is only used to check the question.
export const maxDuration = 120;

const MAX_FILES = 3;
/** Base64 characters across all files: about 3 MB of files, under the host's 4.5 MB request limit. */
const MAX_FILE_CHARS = 4_000_000;

const body = z.object({
  chatId: z.string().max(40).optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().max(4000) }))
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]!.role === "user", "The last message must be the user's."),
  attachments: z
    .array(z.object({ name: z.string().trim().min(1).max(200), type: z.string().max(120), data: z.string().min(1) }))
    .max(MAX_FILES)
    .default([])
    .refine((a) => a.reduce((n, f) => n + f.data.length, 0) <= MAX_FILE_CHARS, "too big"),
});

type StreamEvent = ChatEvent | { type: "chat"; id: string; title: string };

const OFFLINE_NOTE = "This computer is offline, so Fitron AI is answering from the books on this computer. Full answers require an internet connection.";
const FAILED = "Fitron AI couldn't answer just now. Try again in a minute.";

export async function POST(req: Request) {
  const u = await aiUser();
  if (u instanceof Response) return u;
  if (!rateLimit(`ai:${u.id}`, 15, 60_000)) return Response.json({ error: "That's a lot of questions in a minute. Wait a moment and try again." }, { status: 429 });
  const raw = await readCapped(req, 4_400_000);
  if (raw === null) return Response.json({ error: "Those files are too big together. Attach up to about 3 MB at a time." }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {}
  const parsed = body.safeParse(json);
  if (!parsed.success) {
    const big = parsed.error.issues.some((i) => i.message === "too big");
    return Response.json({ error: big ? "Those files are too big together. Attach up to about 3 MB at a time." : "Bad request." }, { status: big ? 413 : 400 });
  }
  const { messages, attachments } = parsed.data;
  const question = messages.at(-1)!.content;
  if (!question && !attachments.length) return Response.json({ error: "Type a question or attach a file." }, { status: 400 });

  // The files, read now: a file that can't be read is said before anything is saved.
  let fileBlocks: Block[];
  let files: ChatAttachment[];
  try {
    files = attachments.map((a) => ({ name: a.name, kind: kindOf(a) }));
    const read = attachments.map((a) => attachmentBlocks(a));
    fileBlocks = read.flat();
    files = attachments.map((a, i) => attachmentRecord(a, read[i]!, ATTACHMENT_TEXT_CAP));
  } catch (e) {
    if (e instanceof AttachmentError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }

  let saved: { id: string; title: string };
  try {
    saved = await chatFor(u, parsed.data.chatId, question, files);
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 404 });
    throw e;
  }
  // Earlier turns come from the saved chat (what was read from files, and what became of each draft), then the files
  // and the question of this turn.
  const earlier: Msg[] = parsed.data.chatId ? await chatHistory(u, saved.id) : [];
  await saveTurn(saved.id, { role: "user", content: question, attachments: files });
  const asked = question || "Read the attached file and tell me what it shows for the gym's accounts.";
  const history: Msg[] = [...earlier, { role: "user", content: fileBlocks.length ? [...fileBlocks, { type: "text", text: asked }] : asked }];

  // FITRON for Windows sends a question and the figures it needs to Claude only once a gym user turned that on in
  // Settings › Integrations & AI; until then Fitron AI answers from the books on the computer, as without a key.
  const model = aiReady() && (!gymAccountingOnly() || (await getAiSettings(u.orgId)).useClaude);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (e: StreamEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      const answer: string[] = [];
      const proposals: ProposalEvent[] = [];
      let error: string | undefined;
      let answered = false;
      // Every event goes to the browser and into the saved turn.
      const relay = async (events: AsyncIterable<ChatEvent>) => {
        for await (const e of events) {
          if (e.type === "text") {
            answer.push(e.text);
            answered = true;
          }
          if (e.type === "proposal") {
            proposals.push(e);
            answered = true;
          }
          if (e.type === "error") error = e.message;
          send(e);
        }
      };
      // On a computer with no internet the model cannot be reached: answer from the books on this computer instead, and
      // say so, rather than waiting on a lookup that fails or showing "couldn't answer".
      const fromBooks = async () => {
        answer.push(OFFLINE_NOTE);
        send({ type: "text", text: OFFLINE_NOTE });
        await relay(localChat(u, asked));
      };
      // Without the model, answer from live data the way the prototype does offline (it can't read files).
      const noModel = async function* (): AsyncIterable<ChatEvent> {
        yield { type: "text", text: gymAccountingOnly() ? "Reading attached files needs Fitron AI's full answers: with a FITRON licence, tick Use Claude in Settings › Integrations & AI." : "Reading attached files needs Fitron AI's model, which isn't switched on for this gym yet." } as ChatEvent;
        yield { type: "done" } as ChatEvent;
      };
      send({ type: "chat", id: saved.id, title: saved.title });
      try {
        if (!model) await relay(fileBlocks.length ? noModel() : localChat(u, asked));
        else if (isLocal() && !(await probablyOnline(aiService()))) await fromBooks();
        else await relay(chat(u, history));
      } catch (e) {
        if (isLocal() && !answered && isNetworkError(e)) {
          log.warn("ai_chat.offline", e);
          await fromBooks().catch((err) => {
            log.error("ai_chat.failed", err);
            error = FAILED;
            send({ type: "error", message: FAILED });
          });
        } else {
          if (!(e instanceof UserError)) log.error("ai_chat.failed", e);
          // A UserError is fitron.in's reason for not answering a FITRON for Windows computer (src/lib/integrations/ai).
          error = e instanceof UserError ? e.message : isLocal() && isNetworkError(e) ? "Fitron AI lost the internet connection while answering. Try again when the computer is online." : FAILED;
          send({ type: "error", message: error });
        }
      }
      try {
        await saveTurn(saved.id, { role: "assistant", content: answer.join("\n\n"), proposals, error });
      } catch (e) {
        log.error("ai_chat.save_failed", e);
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
