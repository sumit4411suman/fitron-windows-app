"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoinsIcon, MagnifyingGlassIcon, ReceiptIcon, UserIcon } from "@phosphor-icons/react";
import type { SearchHit } from "@/lib/services/shell";

const ICON = { member: UserIcon, invoice: ReceiptIcon, payment: HandCoinsIcon };

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d: { results: SearchHit[] }) => {
          setHits(d.results);
          setCursor(0);
        })
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  useEffect(() => {
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const go = (h: SearchHit) => {
    setQ("");
    setHits(null);
    setOpen(false);
    router.push(h.href);
  };
  const shown = open && q.trim().length >= 2 && hits !== null;

  return (
    <div ref={box} className="relative order-last basis-full lg:order-none lg:max-w-[520px] lg:min-w-[200px] lg:flex-[1_1_280px]">
      <MagnifyingGlassIcon size={18} weight="duotone" className="pointer-events-none absolute top-[9px] left-2.5 text-muted" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (e.target.value.trim().length < 2) setHits(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!shown || !hits?.length) return;
          if (e.key === "ArrowDown") setCursor((c) => (c + 1) % hits.length);
          else if (e.key === "ArrowUp") setCursor((c) => (c - 1 + hits.length) % hits.length);
          else if (e.key === "Enter") go(hits[cursor]!);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
        placeholder="Search members, phone, invoice, payment, transaction ID"
        aria-label="Search"
        className="min-h-9 w-full rounded-md border border-line bg-surface py-1.5 pr-2.5 pl-[34px] text-fg placeholder:text-fg/65 hover:border-fg/45 focus:border-accent focus:outline-none"
      />
      {shown && (
        <div className="absolute top-[42px] right-0 left-0 z-40 flex max-h-[420px] flex-col gap-0.5 overflow-auto rounded-lg bg-bg p-2 shadow-lg">
          {hits.length === 0 ? (
            <div className="p-2.5 text-[13px] text-muted">Nothing matches “{q.trim()}”.</div>
          ) : (
            hits.map((h, i) => {
              const I = ICON[h.kind];
              return (
                <button
                  key={h.kind + h.href + h.title}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(h)}
                  className={`flex items-center gap-2.5 rounded-md p-2 text-left ${i === cursor ? "bg-accent-soft" : ""}`}
                >
                  <I size={18} weight="duotone" className="shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{h.title}</span>
                    <span className="block truncate text-xs text-muted">{h.sub}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
