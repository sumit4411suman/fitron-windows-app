import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import type { Msg } from "@/lib/integrations/ai";
import { NO_LONGER, NOT_SAVED } from "@/lib/domain/ai-drafts";
import { UserError } from "./errors";
import type { ProposalEvent } from "./ai";

// Fitron AI's saved conversations. Each belongs to the person who had it: nobody else in the gym sees or deletes it.
// Attached files are never kept here: a question keeps their names and, for a file read as text (CSV, Excel, Word),
// the text that was read, so the model still has it on the next question. PDFs and photos keep only their names.

export type ChatAttachment = { name: string; kind: string; text?: string };
export type SavedProposal = ProposalEvent & { status?: string; result?: string | null };
export type ChatTurn = { role: "user" | "assistant"; content: string; attachments?: ChatAttachment[]; proposals?: SavedProposal[]; error?: string };

const mine = (u: CurrentUser) => ({ orgId: u.orgId, userId: u.id });

/** How much of a file's text a saved question keeps for later turns (the model read up to 60k on the turn itself). */
export const ATTACHMENT_TEXT_CAP = 20_000;

/** The current state of the drafts in a set of turns, by draft id, from the person's own proposals. */
async function proposalStates(u: CurrentUser, turns: { proposals: unknown }[]) {
  const ids = turns.flatMap((m) => ((m.proposals as SavedProposal[] | null) ?? []).map((p) => p.id));
  const rows = ids.length ? await db.aiProposal.findMany({ where: { id: { in: ids }, ...mine(u) }, select: { id: true, status: true, result: true } }) : [];
  return new Map(rows.map((p) => [p.id, p]));
}

/** What the model is told about a draft it offered earlier, so it never treats a discarded one as saved, or a saved one as open. */
export function draftStatusNote(p: SavedProposal): string {
  const name = `Draft "${p.summary}"`;
  if (p.status === "DONE") return `[${name}: the user confirmed it and it was saved${p.result ? ` (${p.result})` : ""}.]`;
  if (p.status === "PENDING" && p.result?.startsWith(NOT_SAVED)) return `[${name}: the user pressed "${p.confirm}" but it failed a check, so nothing was saved: ${p.result.slice(NOT_SAVED.length).trim()} The card is still open.]`;
  if (p.status === "PENDING") return `[${name}: still waiting for the user's decision on its card ("${p.confirm}" or Discard); nothing is saved yet.]`;
  if (p.result?.startsWith(NO_LONGER)) return `[${name}: its card was retired because another card for the same action was confirmed; this one was not saved.]`;
  return `[${name}: the user discarded it (or it expired), so it was never saved. If they ask for it again, make a fresh draft with the tool.]`;
}

/** An earlier question's attachment as the model sees it on later turns: the text it read, or a note that it read the file then. */
export function attachmentRecap(a: ChatAttachment): string {
  if (a.text) return a.text;
  const what = a.kind === "pdf" ? "PDF" : a.kind === "image" ? "photo" : "file";
  return `[The ${what} "${a.name}" was attached to this message and you read it then. It is not shown again; rely on what you said about it in your reply.]`;
}

/**
 * Saved turns as the messages the model reads: the text of each side, with what was read from attached files and
 * the current state of every draft offered. Failed turns are left out; same-side turns in a row are joined.
 */
export function historyMessages(turns: ChatTurn[]): Msg[] {
  const out: { role: "user" | "assistant"; parts: string[] }[] = [];
  for (const t of turns) {
    if (t.error) continue;
    const parts: string[] = [];
    if (t.role === "user") {
      for (const a of t.attachments ?? []) parts.push(attachmentRecap(a));
      if (t.content) parts.push(t.content);
    } else {
      if (t.content) parts.push(t.content);
      for (const p of t.proposals ?? []) parts.push(draftStatusNote(p));
    }
    if (!parts.length) continue;
    const last = out.at(-1);
    if (last && last.role === t.role) last.parts.push(...parts);
    else out.push({ role: t.role, parts });
  }
  return out.map((m) => ({ role: m.role, content: m.parts.join("\n\n") }));
}

/** The saved conversation of one of the person's chats, as the model's messages. Drafts carry their state as of now. */
export async function chatHistory(u: CurrentUser, id: string): Promise<Msg[]> {
  const messages = await db.aiChatMessage.findMany({ where: { chatId: id, chat: mine(u) }, orderBy: { createdAt: "asc" } });
  const state = await proposalStates(u, messages);
  return historyMessages(
    messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
      attachments: (m.attachments as ChatAttachment[] | null) ?? undefined,
      proposals: ((m.proposals as SavedProposal[] | null) ?? []).map((p) => ({ ...p, status: state.get(p.id)?.status ?? "DISMISSED", result: state.get(p.id)?.result ?? null })),
      error: m.error ?? undefined,
    })),
  );
}

/** A chat's title: the start of its first question, on one line. */
export const chatTitle = (question: string, files: ChatAttachment[] = []) => {
  const q = question.replace(/\s+/g, " ").trim();
  const t = q || (files.length ? `File: ${files.map((f) => f.name).join(", ")}` : "New chat");
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t;
};

/** The person's chats, newest first. */
export function listChats(u: CurrentUser, take = 50) {
  return db.aiChat.findMany({ where: mine(u), orderBy: { updatedAt: "desc" }, take, select: { id: true, title: true, updatedAt: true } });
}

/** One of the person's chats with its messages; drafts it offered carry their current state (pending, done, dismissed). */
export async function getChat(u: CurrentUser, id: string): Promise<{ id: string; title: string; turns: ChatTurn[] }> {
  const chat = await db.aiChat.findFirst({ where: { id, ...mine(u) }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!chat) throw new UserError("That chat was not found. It may have been deleted.");
  const state = await proposalStates(u, chat.messages);
  return {
    id: chat.id,
    title: chat.title,
    turns: chat.messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
      // The screen shows the file chips; the text read from a file stays on the server for the model.
      attachments: (m.attachments as ChatAttachment[] | null)?.map(({ name, kind }) => ({ name, kind })),
      proposals: ((m.proposals as SavedProposal[] | null) ?? []).map((p) => ({ ...p, status: state.get(p.id)?.status ?? "DISMISSED", result: state.get(p.id)?.result ?? null })),
      error: m.error ?? undefined,
    })),
  };
}

/** Deletes one of the person's chats and its messages. */
export async function deleteChat(u: CurrentUser, id: string) {
  const { count } = await db.aiChat.deleteMany({ where: { id, ...mine(u) } });
  if (!count) throw new UserError("That chat was not found. It may have been deleted already.");
}

/** The chat a question goes into: the given one if it is the person's, or a new one titled after the question. */
export async function chatFor(u: CurrentUser, id: string | undefined, question: string, files: ChatAttachment[]) {
  if (id) {
    const chat = await db.aiChat.findFirst({ where: { id, ...mine(u) }, select: { id: true, title: true } });
    if (!chat) throw new UserError("That chat was not found. It may have been deleted. Start a new one.");
    return chat;
  }
  return db.aiChat.create({ data: { ...mine(u), title: chatTitle(question, files) }, select: { id: true, title: true } });
}

/** Adds a message to a chat and moves the chat to the top of the history. */
export async function saveTurn(chatId: string, t: ChatTurn) {
  await db.$transaction([
    db.aiChatMessage.create({
      data: {
        chatId,
        role: t.role,
        content: t.content,
        attachments: t.attachments?.length ? (t.attachments as Prisma.InputJsonValue) : undefined,
        proposals: t.proposals?.length ? (t.proposals as unknown as Prisma.InputJsonValue) : undefined,
        error: t.error,
      },
    }),
    db.aiChat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }),
  ]);
}
