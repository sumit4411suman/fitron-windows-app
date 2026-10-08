"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowsClockwiseIcon,
  DotsThreeCircleIcon,
  FilePlusIcon,
  HandCoinsIcon,
  UserPlusIcon,
  WalletIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";

export type QuickKey = "member" | "collect" | "invoice" | "expense" | "renew" | "whatsapp";

const ACTIONS: Record<QuickKey, { label: string; href: string; icon: typeof UserPlusIcon }> = {
  member: { label: "Add member", href: "/members/new", icon: UserPlusIcon },
  collect: { label: "Collect payment", href: "/receivables", icon: HandCoinsIcon },
  invoice: { label: "Create invoice", href: "/invoices/new", icon: FilePlusIcon },
  expense: { label: "Add expense", href: "/expenses", icon: WalletIcon },
  renew: { label: "Renew membership", href: "/renewals", icon: ArrowsClockwiseIcon },
  whatsapp: { label: "Send WhatsApp", href: "/whatsapp/send", icon: WhatsappLogoIcon },
};

/** The prototype's quick-action bar: the first three as buttons (the first gold), the rest under "More". */
export function QuickActions({ keys }: { keys: QuickKey[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  if (!keys.length) return null;
  const main = keys.slice(0, 3);
  const more = keys.slice(3);
  const btn = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border px-[18px] text-sm font-semibold whitespace-nowrap";
  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-line bg-surface p-2.5">
      {main.map((k, i) => {
        const a = ACTIONS[k];
        return (
          <Link key={k} href={a.href} className={`${btn} ${i === 0 ? "border-transparent bg-accent text-accent-ink hover:bg-accent-hover" : "border-line hover:bg-fg/7"}`}>
            <a.icon size={17} weight="duotone" />
            {a.label}
          </Link>
        );
      })}
      {more.length > 0 && (
        <span ref={ref} className="relative">
          <button type="button" onClick={() => setOpen((o) => !o)} className={`${btn} border-transparent px-1.5 text-accent hover:bg-accent/10`} aria-expanded={open}>
            <DotsThreeCircleIcon size={17} weight="duotone" />
            More
          </button>
          {open && (
            <div className="absolute top-[calc(100%+6px)] right-0 z-30 flex min-w-[200px] flex-col rounded-lg border border-line bg-surface p-1.5 shadow-lg">
              {more.map((k) => {
                const a = ACTIONS[k];
                return (
                  <Link key={k} href={a.href} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-md px-2.5 py-[9px] text-sm hover:bg-accent-soft">
                    <a.icon size={17} weight="duotone" className="text-accent" />
                    {a.label}
                  </Link>
                );
              })}
            </div>
          )}
        </span>
      )}
    </div>
  );
}
