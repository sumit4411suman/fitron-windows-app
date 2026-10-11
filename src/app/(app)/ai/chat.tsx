"use client";

import { BrandMark } from "@/components/logo";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  CurrencyInrIcon,
  FileDocIcon,
  FilePdfIcon,
  FileTextIcon,
  FileXlsIcon,
  FunnelIcon,
  ImageIcon,
  PackageIcon,
  PaperPlaneTiltIcon,
  PaperclipIcon,
  PlusIcon,
  TrashIcon,
  TrendUpIcon,
  UserCircleMinusIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { cx } from "@/components/ui";
import { MarkdownLite } from "@/components/markdown-lite";
import type { BriefCard } from "@/lib/services/ai-local";
import { TOOL_LABEL } from "@/lib/domain/ai-labels";
import { dismissProposalAction, sendProposalAction } from "./actions";

type Proposal = { id: string; kind: string; summary: string; members: number; body: string; confirm: string; status?: string; result?: string | null };
type FileTag = { name: string; kind: string };
type Turn = { role: "user" | "assistant"; content: string; attachments?: FileTag[]; proposals?: Proposal[]; error?: string };
type ChatSummary = { id: string; title: string; updatedAt: string };
/** A file picked for the next question, read in the browser as base64 (photos shrunk first). */
type Picked = { name: string; type: string; data: string };
/** A question asked while the previous answer was still coming. */
type Queued = { question: string; files: Picked[] };

const SUGGESTIONS = [
  "Who owes us money?",
  "GST collected this month",
  "Create an invoice for a member",
  "How is this month vs last month?",
  "Record an expense",
  "Which invoices are overdue?",
  "What can you do?",
];
const GREETING: Turn = {
  role: "assistant",
  content:
    "Hi! I'm your accounting assistant. I read your gym's live books and can answer questions on GST, invoices, payments, expenses, profit and cash. I can also prepare invoices, membership sales, payments and expenses: each comes as a card you check and then press its button (Create invoice, Sell membership, Record payment, Record expense…); nothing is saved until you do. You can attach a bill, photo, PDF, Excel or Word file too.",
};

/** What the file picker offers; the server reads the same kinds (src/lib/files/read-attachment.ts). */
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.xlsx,.docx,.csv,.txt,application/pdf,image/*";
const MAX_FILES = 3;
/** Base64 characters the server takes in one question (about 3 MB of files). */
const MAX_CHARS = 4_000_000;

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** A photo made small enough to send (1600 px on its longest side, JPEG). Other files are sent as they are. */
async function readPicked(file: File): Promise<Picked> {
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
      if (blob) return { name: file.name, type: "image/jpeg", data: await toBase64(blob) };
    } catch {
      // Fall back to the original file.
    }
  }
  return { name: file.name, type: file.type, data: await toBase64(file) };
}

const fileKind = (name: string, type: string) => {
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (type.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(name)) return "image";
  if (/\.xlsx$/i.test(name)) return "excel";
  if (/\.docx$/i.test(name)) return "word";
  return "text";
};

/** The conversation, streamed from /api/ai/chat (the model, or the built-in answers without a key), saved as a chat. */
export function useAiChat() {
  const [turns, setTurns] = useState<Turn[]>([GREETING]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [fileError, setFileError] = useState("");
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  // Questions asked while an answer is still coming: kept here and sent one by one once it ends, never dropped.
  const [queued, setQueued] = useState<Queued[]>([]);
  const queue = useRef<Queued[]>([]);
  const busyRef = useRef(false);
  // The chat a queued question goes into: the one the first answer created, even though that closure never saw it.
  const chatIdRef = useRef<string | null>(null);
  const setChat = (id: string | null) => {
    chatIdRef.current = id;
    setChatId(id);
  };

  async function addFiles(list: FileList | null) {
    setFileError("");
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    if (files.length + picked.length > MAX_FILES) return setFileError(`Attach up to ${MAX_FILES} files at a time.`);
    try {
      const read = await Promise.all(picked.map(readPicked));
      const next = [...files, ...read];
      if (next.reduce((n, f) => n + f.data.length, 0) > MAX_CHARS) return setFileError("Those files are too big together. Attach up to about 3 MB at a time.");
      setFiles(next);
    } catch {
      setFileError("That file couldn't be read. Try again or pick another.");
    }
  }
  const removeFile = (i: number) => setFiles((fs) => fs.filter((_, j) => j !== i));

  /** Asks a question (with the files picked so far). While an answer is still coming it is queued and sent after. */
  function ask(q: string) {
    const question = q.trim();
    if (!question && !files.length) return;
    const sending = files;
    setFiles([]);
    setFileError("");
    if (busyRef.current) {
      queue.current = [...queue.current, { question, files: sending }];
      setQueued(queue.current);
      return;
    }
    void send(question, sending);
  }
  function unqueue(i: number) {
    queue.current = queue.current.filter((_, j) => j !== i);
    setQueued(queue.current);
  }

  async function send(question: string, sending: Picked[]) {
    const tags = sending.map((f) => ({ name: f.name, kind: fileKind(f.name, f.type) }));
    busyRef.current = true;
    setBusy(true);
    setStep(sending.length ? "Reading your file…" : "Reading your books…");
    let id = chatIdRef.current;
    setTurns((ts) => [...ts, { role: "user", content: question, attachments: tags }, { role: "assistant", content: "", proposals: [] }]);
    const patch = (f: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), f(ts[ts.length - 1]!)]);
    try {
      // The server keeps the conversation (with what it read from files and what became of each draft), so only the
      // question goes up; it continues the saved chat named by chatId.
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: id ?? undefined, messages: [{ role: "user", content: question }], attachments: sending }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        patch((t) => ({ ...t, error: j.error ?? "Something went wrong." }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === "chat") {
            id = e.id;
            setChat(e.id);
            setChats(null); // the history list is out of date now
          }
          if (e.type === "text") patch((t) => ({ ...t, content: t.content ? `${t.content}\n\n${e.text}` : e.text }));
          if (e.type === "tool") setStep(TOOL_LABEL[e.name] ? `${TOOL_LABEL[e.name]}…` : "Working…");
          if (e.type === "proposal") patch((t) => ({ ...t, proposals: [...(t.proposals ?? []), e] }));
          if (e.type === "error") patch((t) => ({ ...t, error: e.message }));
        }
      }
      // The answer stopped before it said anything (the server's time ran out, the connection dropped): say so instead of
      // leaving an empty reply.
      patch((t) => (t.content || t.error || t.proposals?.length ? t : { ...t, error: "Fitron AI didn't answer that time. Try again, or ask a narrower question." }));
    } catch {
      patch((t) => ({ ...t, error: "Couldn't reach Fitron AI. Check the connection and try again." }));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setStep("");
      const next = queue.current.shift();
      setQueued([...queue.current]);
      if (next) void send(next.question, next.files);
    }
  }

  /** Cards retired by the server when another was confirmed (the same action for the same member) stop working on screen too. */
  function retire(ids: string[], why: string) {
    if (!ids.length) return;
    const gone = new Set(ids);
    setTurns((ts) => ts.map((t) => (t.proposals?.some((p) => gone.has(p.id)) ? { ...t, proposals: t.proposals!.map((p) => (gone.has(p.id) ? { ...p, status: "DISMISSED", result: why } : p)) } : t)));
  }

  async function loadChats() {
    const res = await fetch("/api/ai/chats").catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    setChats(j?.chats ?? []);
  }
  async function openChat(id: string) {
    if (busyRef.current) return;
    const res = await fetch(`/api/ai/chats/${encodeURIComponent(id)}`).catch(() => null);
    const j = res?.ok ? await res.json().catch(() => null) : null;
    if (!j) return loadChats();
    setChat(j.id);
    setTurns([GREETING, ...j.turns]);
    setFiles([]);
  }
  function newChat() {
    if (busyRef.current) return;
    setChat(null);
    setTurns([GREETING]);
    setFiles([]);
    setFileError("");
  }
  async function removeChat(id: string) {
    await fetch(`/api/ai/chats/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    setChats((cs) => cs?.filter((c) => c.id !== id) ?? null);
    if (id === chatId) newChat();
  }

  return { turns, busy, step, ask, queued, unqueue, retire, chatId, files, fileError, addFiles, removeFile, chats, loadChats, openChat, newChat, removeChat };
}

const FILE_ICON = { pdf: FilePdfIcon, image: ImageIcon, excel: FileXlsIcon, word: FileDocIcon, text: FileTextIcon } as const;
function FileChip({ f, onRemove, light }: { f: FileTag; onRemove?: () => void; light?: boolean }) {
  const Icon = FILE_ICON[f.kind as keyof typeof FILE_ICON] ?? FileTextIcon;
  return (
    <span className={cx("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]", light ? "border-bg/30" : "border-line bg-bg")}>
      <Icon size={15} weight="duotone" className="flex-none" />
      <span className="min-w-0 truncate">{f.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${f.name}`} className="-mr-1 grid h-5 w-5 flex-none place-items-center rounded-full hover:bg-fg/10">
          <XIcon size={12} weight="bold" />
        </button>
      )}
    </span>
  );
}

const whenShort = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** Saved chats: open one or delete one. */
function ChatHistory({ chat, onClose }: { chat: ReturnType<typeof useAiChat>; onClose: () => void }) {
  const { chats, loadChats, openChat, removeChat, chatId } = chat;
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    if (chats === null) void loadChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats]);
  return (
    <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-3">
      {chats === null && <p className="px-1 py-2 text-sm text-muted">Loading your chats…</p>}
      {chats?.length === 0 && <p className="px-1 py-2 text-sm text-muted">No saved chats yet. Your questions are saved here as you ask them.</p>}
      {chats?.map((c) => (
        <div key={c.id} className={cx("flex items-center gap-2 rounded-lg px-2 py-1.5", c.id === chatId ? "bg-accent-soft" : "hover:bg-fg/5")}>
          {confirm === c.id ? (
            <>
              <span className="min-w-0 flex-1 truncate text-[13.5px]">Delete this chat?</span>
              <button type="button" onClick={() => void removeChat(c.id).then(() => setConfirm(null))} className="rounded-md bg-alert px-2.5 py-1 text-[12.5px] font-semibold text-white">
                Delete
              </button>
              <button type="button" onClick={() => setConfirm(null)} className="rounded-md px-2 py-1 text-[12.5px] hover:bg-fg/7">
                Keep
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  void openChat(c.id);
                  onClose();
                }}
                className="flex min-w-0 flex-1 flex-col items-start text-left"
              >
                <span className="w-full truncate text-[14px] font-medium">{c.title}</span>
                <span className="text-[12px] text-muted">{whenShort(c.updatedAt)}</span>
              </button>
              <button type="button" onClick={() => setConfirm(c.id)} aria-label={`Delete chat: ${c.title}`} className="grid h-8 w-8 flex-none place-items-center rounded-full text-muted hover:bg-fg/7 hover:text-alert">
                <TrashIcon size={16} weight="duotone" />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function ProposalButtons({ p, onRetired }: { p: Proposal; onRetired: (ids: string[], why: string) => void }) {
  const [sent, send, sending] = useActionState(sendProposalAction.bind(null, p.id), undefined);
  const [dropped, drop, dropping] = useActionState(dismissProposalAction.bind(null, p.id), undefined);
  const chip = "inline-flex items-center rounded-full border border-line bg-bg px-3 py-1.5 text-[13px] font-semibold hover:bg-fg/7 disabled:opacity-45";
  const whatsapp = p.kind === "WHATSAPP";
  useEffect(() => {
    if (sent?.ok && sent.retired?.length) onRetired(sent.retired, `No longer available: "${p.summary}" was confirmed instead.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent]);
  // Not open any more: say what became of it (saved, discarded, retired by another card, or failed a check).
  if (p.status && p.status !== "PENDING" && !sent && !dropped)
    return <div className={cx("mt-2.5 text-[13px]", p.status !== "DONE" && p.result ? "text-alert" : "text-muted")}>{p.status === "DONE" ? (p.result ?? "Done.") : (p.result ?? (whatsapp ? "Not sent." : "Discarded. Nothing was saved."))}</div>;
  if (sent?.message)
    return (
      <div className={cx("mt-2.5 text-[13px]", sent.ok ? "text-ok" : "text-alert")}>
        {sent.message}
        {sent.ok && sent.href && (
          <span className="mt-1 flex flex-wrap gap-3">
            <Link href={sent.href} className="font-semibold underline">
              Open
            </Link>
            {sent.pdf && (
              <a href={sent.pdf} target="_blank" rel="noreferrer" className="font-semibold underline">
                Invoice PDF
              </a>
            )}
          </span>
        )}
      </div>
    );
  if (dropped?.ok) return <div className="mt-2.5 text-[13px] text-muted">{whatsapp ? "Not sent." : "Discarded. Nothing was saved."}</div>;
  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {p.result && <div className="text-[13px] text-alert">{p.result}</div>}
      {whatsapp ? (
        <details className="text-[13px] text-muted">
          <summary className="cursor-pointer">Message to {p.members} member{p.members === 1 ? "" : "s"}</summary>
          <p className="mt-1 whitespace-pre-line">{p.body}</p>
        </details>
      ) : (
        <div className="rounded-lg border border-line bg-bg px-3 py-2 text-[13px] leading-[1.55] whitespace-pre-line">{p.body}</div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <form action={send}>
          <button className={chip} disabled={sending || dropping}>
            {sending ? "Working…" : p.confirm}
          </button>
        </form>
        <form action={drop}>
          <button className={cx(chip, "font-normal")} disabled={sending || dropping}>
            {whatsapp ? "Don\u2019t send" : "Discard"}
          </button>
        </form>
      </div>
    </div>
  );
}

/** The chat column: history, messages, suggestion chips, attachments and the input. `drawer` is the panel behind "Ask Fitron AI". */
export function ChatPanel({ chat, drawer = false }: { chat: ReturnType<typeof useAiChat>; drawer?: boolean }) {
  const { turns, busy, step, ask, queued, unqueue, retire, files, fileError, addFiles, removeFile } = chat;
  const [text, setText] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // A block body, so the effect returns nothing: newer browsers return a promise from scrollIntoView, and an effect that
  // returned it had React call it as the cleanup on the next answer ("i is not a function").
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);
  const submit = () => {
    const q = text;
    setText("");
    void ask(q);
  };
  const pad = drawer ? "px-6" : "px-[18px]";
  return (
    <>
      <div className={cx("flex flex-none items-center gap-2 border-b border-line py-2", pad)}>
        <button type="button" onClick={() => setShowHistory((v) => !v)} aria-pressed={showHistory} className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold", showHistory ? "bg-accent-soft text-accent" : "hover:bg-fg/7")}>
          <ClockCounterClockwiseIcon size={16} weight="duotone" />
          {showHistory ? "Back to chat" : "History"}
        </button>
        <button type="button" onClick={() => (chat.newChat(), setShowHistory(false))} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold hover:bg-fg/7 disabled:opacity-45">
          <PlusIcon size={15} weight="bold" />
          New chat
        </button>
      </div>
      {showHistory ? (
        <ChatHistory chat={chat} onClose={() => setShowHistory(false)} />
      ) : (
        <div className={cx("no-scrollbar flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto", drawer ? "gap-3.5 px-6 pt-5 pb-3" : "max-h-[520px] gap-3 p-[18px]")}>
          {turns.map((t, i) => (
            <div
              key={i}
              className={cx(
                "max-w-[86%] px-[15px] py-[11px] text-sm leading-[1.55] [overflow-wrap:anywhere]",
                t.role === "user" && "whitespace-pre-wrap",
                drawer ? "rounded-[18px] border border-line-soft text-[14.5px]" : "rounded-2xl shadow-sm",
                t.role === "user" ? "self-end bg-fg text-bg" : cx("self-start", drawer ? "bg-surface" : "bg-bg"),
              )}
            >
              {!!t.attachments?.length && (
                <div className={cx("flex flex-wrap gap-1.5", t.content && "mb-2")}>
                  {t.attachments.map((f, j) => (
                    <FileChip key={j} f={f} light={t.role === "user"} />
                  ))}
                </div>
              )}
              {t.role === "assistant" ? <MarkdownLite text={t.content} /> : t.content}
              {t.error && <span className="text-alert">{t.error}</span>}
              {t.proposals?.map((p) => <ProposalButtons key={p.id} p={p} onRetired={retire} />)}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 self-start rounded-2xl px-3.5 py-2.5 text-[13px] text-muted">
              <CircleNotchIcon size={16} weight="duotone" className="animate-spin text-accent" />
              {step}
            </div>
          )}
          {queued.map((q, i) => (
            <div key={i} className="flex max-w-[86%] items-center gap-2 self-end rounded-2xl border border-dashed border-fg/30 px-[15px] py-[9px] text-[13px] text-muted">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">Queued</span> · sent when this reply finishes: {q.question || q.files.map((f) => f.name).join(", ")}
              </span>
              <button type="button" onClick={() => unqueue(i)} aria-label="Remove from queue" className="grid h-6 w-6 flex-none place-items-center rounded-full hover:bg-fg/10">
                <XIcon size={12} weight="bold" />
              </button>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}
      <div className={cx("flex flex-none flex-col gap-2.5 border-t border-line", drawer ? "py-3 pb-[18px]" : "px-[18px] pt-3 pb-4")}>
        {!showHistory && (
          <div className={cx("no-scrollbar flex gap-1.5 overflow-x-auto", drawer && "px-6")}>
            {(turns.length <= 2 ? SUGGESTIONS : SUGGESTIONS.slice(0, 3)).map((s) => (
              <button key={s} type="button" onClick={() => ask(s)} disabled={busy} className="flex-none rounded-full border border-line px-3 py-1.5 text-[13px] whitespace-nowrap hover:border-accent hover:text-accent disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        )}
        {(files.length > 0 || fileError) && (
          <div className={cx("flex flex-wrap items-center gap-1.5", drawer && "px-6")}>
            {files.map((f, i) => (
              <FileChip key={i} f={{ name: f.name, kind: fileKind(f.name, f.type) }} onRemove={() => removeFile(i)} />
            ))}
            {fileError && <span className="text-[13px] text-alert">{fileError}</span>}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setShowHistory(false);
            submit();
          }}
          className={cx("flex items-center gap-1.5 border border-fg/25", drawer ? "mx-6 rounded-full bg-surface py-1 pr-1 pl-1.5" : "rounded-[14px] bg-bg py-1.5 pr-1.5 pl-1.5")}
        >
          <input
            ref={picker}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button type="button" onClick={() => picker.current?.click()} disabled={busy || files.length >= MAX_FILES} aria-label="Attach a PDF, photo, Excel or Word file" title="Attach a PDF, photo, Excel or Word file" className="grid h-9 w-9 flex-none place-items-center rounded-full text-fg/70 hover:bg-fg/7 disabled:opacity-40">
            <PaperclipIcon size={19} weight="duotone" />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={files.length ? "Ask about the file…" : drawer ? "Ask about GST, invoices, dues…" : "Ask about your accounts, or say \u201Ccreate an invoice\u201D…"}
            aria-label="Ask Fitron AI"
            maxLength={4000}
            className="min-w-0 flex-1 border-0 bg-transparent py-2 text-[15px] text-fg outline-0 placeholder:text-fg/55"
          />
          <button disabled={!text.trim() && !files.length} aria-label={busy ? "Send after this reply" : "Send"} title={busy ? "Sent when the current reply finishes" : undefined} className={cx("grid flex-none place-items-center bg-accent text-accent-ink hover:bg-accent-hover disabled:opacity-45", drawer ? "h-10 w-10 rounded-full" : "rounded-[10px] px-3.5 py-2.5")}>
            {drawer ? <ArrowUpIcon size={18} weight="bold" /> : <PaperPlaneTiltIcon size={18} weight="duotone" />}
          </button>
        </form>
      </div>
    </>
  );
}

const ICON = { risk: UserCircleMinusIcon, renew: ArrowsClockwiseIcon, money: CurrencyInrIcon, trend: TrendUpIcon, stock: PackageIcon, autopay: WarningIcon, lead: FunnelIcon };

/** The full Fitron AI page: today's brief on the left (its buttons can ask the chat), the chat on the right. */
export function AiWorkspace({ brief, today }: { brief: BriefCard[]; today: string }) {
  const chat = useAiChat();
  return (
    <div className="grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))]">
      <section className="flex flex-col gap-1 rounded-lg bg-surface p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[17px]">Today&apos;s brief</h3>
          <span className="text-xs text-muted">{today}</span>
        </div>
        {brief.map((b) => {
          const Icon = ICON[b.icon];
          return (
            <div key={b.title} className="flex items-start gap-3 border-t border-line py-3">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-accent-soft">
                <Icon size={18} weight="duotone" className="text-accent" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="text-sm font-semibold">{b.title}</div>
                <div className="text-[13px] leading-[1.55] text-fg/80">{b.text}</div>
                {b.action &&
                  (b.action.href ? (
                    <Link href={b.action.href} className="mt-1.5 inline-flex items-center gap-1.5 self-start rounded-md border border-line px-3 py-1.5 text-[13px] font-semibold hover:bg-fg/7">
                      {b.action.label}
                      <ArrowRightIcon size={14} weight="duotone" />
                    </Link>
                  ) : (
                    <button type="button" onClick={() => chat.ask(b.action!.ask!)} className="mt-1.5 inline-flex items-center gap-1.5 self-start rounded-md border border-line px-3 py-1.5 text-[13px] font-semibold hover:bg-fg/7">
                      {b.action.label}
                      <ArrowRightIcon size={14} weight="duotone" />
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
        {!brief.length && <p className="border-t border-line py-3 text-sm text-muted">Nothing needs attention right now.</p>}
      </section>
      <section className="flex min-h-[560px] flex-col overflow-hidden rounded-lg bg-surface">
        <div className="flex items-center gap-2.5 border-b border-line px-[18px] py-3.5">
          <BrandMark size={30} className="rounded-full" />
          <div>
            <div className="text-sm font-semibold">Chat with Fitron AI</div>
            <div className="text-xs text-muted">Accounting, GST, invoices and billing · asks before saving</div>
          </div>
        </div>
        <ChatPanel chat={chat} />
      </section>
    </div>
  );
}
