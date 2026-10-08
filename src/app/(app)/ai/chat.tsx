"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRightIcon, ArrowUpIcon, ArrowsClockwiseIcon, CircleNotchIcon, CurrencyInrIcon, FunnelIcon, PackageIcon, PaperPlaneTiltIcon, TrendUpIcon, UserCircleMinusIcon, WarningIcon } from "@phosphor-icons/react";
import { cx } from "@/components/ui";
import type { BriefCard } from "@/lib/services/ai-local";
import { TOOL_LABEL } from "@/lib/domain/ai-labels";
import { dismissProposalAction, sendProposalAction } from "./actions";

type Proposal = { id: string; kind: string; summary: string; members: number; body: string; confirm: string };
type Turn = { role: "user" | "assistant"; content: string; proposals?: Proposal[]; error?: string };

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
    "Hi! I'm your accounting assistant. I read your gym's live books and can answer questions on GST, invoices, payments, expenses, profit and cash. I can also prepare invoices, membership sales, payments and expenses. You check each one and press Confirm; nothing is saved until you do.",
};

/** The conversation, streamed from /api/ai/chat (the model, or the built-in answers without a key). */
export function useAiChat() {
  const [turns, setTurns] = useState<Turn[]>([GREETING]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  async function ask(q: string) {
    if (!q.trim() || busy) return;
    const history = [...turns.slice(1).filter((t) => !t.error && t.content), { role: "user" as const, content: q.trim() }];
    setTurns((ts) => [...ts, { role: "user", content: q.trim() }, { role: "assistant", content: "", proposals: [] }]);
    setBusy(true);
    setStep("Reading your books…");
    const patch = (f: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), f(ts[ts.length - 1]!)]);
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history.slice(-20).map(({ role, content }) => ({ role, content })) }) });
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
      setBusy(false);
      setStep("");
    }
  }
  return { turns, busy, step, ask };
}

function ProposalButtons({ p }: { p: Proposal }) {
  const [sent, send, sending] = useActionState(sendProposalAction.bind(null, p.id), undefined);
  const [dropped, drop, dropping] = useActionState(dismissProposalAction.bind(null, p.id), undefined);
  const chip = "inline-flex items-center rounded-full border border-line bg-bg px-3 py-1.5 text-[13px] font-semibold hover:bg-fg/7 disabled:opacity-45";
  const whatsapp = p.kind === "WHATSAPP";
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

/** The chat column: messages, suggestion chips and the input. `drawer` is the side panel behind "Ask Fitron AI". */
export function ChatPanel({ chat, drawer = false }: { chat: ReturnType<typeof useAiChat>; drawer?: boolean }) {
  const { turns, busy, step, ask } = chat;
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [turns, busy]);
  const submit = () => {
    const q = text;
    setText("");
    void ask(q);
  };
  return (
    <>
      <div className={cx("flex min-h-0 flex-1 flex-col overflow-y-auto", drawer ? "gap-3.5 px-6 pt-5 pb-3" : "max-h-[520px] gap-3 p-[18px]")}>
        {turns.map((t, i) => (
          <div
            key={i}
            className={cx(
              "max-w-[86%] px-[15px] py-[11px] text-sm leading-[1.55] whitespace-pre-wrap",
              drawer ? "rounded-[18px] border border-line-soft text-[14.5px]" : "rounded-2xl shadow-sm",
              t.role === "user" ? "self-end bg-fg text-bg" : cx("self-start", drawer ? "bg-surface" : "bg-bg"),
            )}
          >
            {t.content}
            {t.error && <span className="text-alert">{t.error}</span>}
            {t.proposals?.map((p) => <ProposalButtons key={p.id} p={p} />)}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 self-start rounded-2xl px-3.5 py-2.5 text-[13px] text-muted">
            <CircleNotchIcon size={16} weight="duotone" className="animate-spin text-accent" />
            {step}
          </div>
        )}
        <div ref={end} />
      </div>
      <div className={cx("flex flex-none flex-col gap-2.5 border-t border-line", drawer ? "py-3 pb-[18px]" : "px-[18px] pt-3 pb-4")}>
        <div className={cx("flex gap-1.5 overflow-x-auto [scrollbar-width:none]", drawer && "px-6")}>
          {(turns.length <= 2 ? SUGGESTIONS : SUGGESTIONS.slice(0, 3)).map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} disabled={busy} className="flex-none rounded-full border border-line px-3 py-1.5 text-[13px] whitespace-nowrap hover:border-accent hover:text-accent disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className={cx("flex items-center gap-2 border border-fg/25", drawer ? "mx-6 rounded-full bg-surface py-1 pr-1 pl-4" : "rounded-[14px] bg-bg py-1.5 pr-1.5 pl-3.5")}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={drawer ? "Ask about GST, invoices, dues…" : "Ask about your accounts, or say \u201Ccreate an invoice\u201D…"}
            aria-label="Ask Fitron AI"
            maxLength={4000}
            className="min-w-0 flex-1 border-0 bg-transparent py-2 text-[15px] text-fg outline-0 placeholder:text-fg/55"
          />
          <button disabled={busy || !text.trim()} aria-label="Send" className={cx("grid flex-none place-items-center bg-accent text-accent-ink hover:bg-accent-hover disabled:opacity-45", drawer ? "h-10 w-10 rounded-full" : "rounded-[10px] px-3.5 py-2.5")}>
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
          <Image src="/fitron-mark.png" alt="" width={30} height={30} className="rounded-full" />
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
