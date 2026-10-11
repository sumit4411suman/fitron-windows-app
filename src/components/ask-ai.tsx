"use client";

import Image from "next/image";
import { BrandMark } from "@/components/logo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowsOutSimpleIcon, XIcon } from "@phosphor-icons/react";
import { ChatPanel, useAiChat } from "@/app/(app)/ai/chat";

/** The floating "Ask Fitron AI" button and the side drawer it opens (prototype), hidden on the Fitron AI page itself. */
export function AskAi() {
  const [open, setOpen] = useState(false);
  const chat = useAiChat();
  const path = usePathname();
  if (path === "/ai") return null;
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-5 bottom-4 z-40 max-lg:bottom-[84px] inline-flex items-center gap-2 rounded-[22px] bg-accent py-[11px] pr-[18px] pl-2.5 text-sm font-semibold whitespace-nowrap text-accent-ink shadow-lg hover:bg-accent-hover print:hidden"
        >
          {/* always the dark disc: a transparent gold mark would vanish on this gold button */}
          <Image src="/fitron-mark-v2.png" alt="" width={26} height={26} className="-my-1 rounded-full" />
          Ask Fitron AI
        </button>
      )}
      {open && (
        <aside role="dialog" aria-label="Fitron AI" className="fixed top-0 right-0 bottom-0 z-[90] flex w-[min(440px,100vw)] flex-col overflow-hidden bg-bg shadow-lg">
          <div className="flex flex-none items-center gap-3.5 border-b border-line py-4 pr-5 pl-6">
            <BrandMark size={44} className="flex-none rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="text-lg leading-tight font-semibold">Fitron AI</div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-muted">Live books · asks before saving</div>
            </div>
            <Link href="/ai" onClick={() => setOpen(false)} aria-label="Open full view" className="grid h-[38px] w-[38px] place-items-center rounded-full text-accent hover:bg-accent/10">
              <ArrowsOutSimpleIcon size={18} weight="duotone" />
            </Link>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-[38px] w-[38px] place-items-center rounded-full text-accent hover:bg-accent/10">
              <XIcon size={18} weight="duotone" />
            </button>
          </div>
          <ChatPanel chat={chat} drawer />
        </aside>
      )}
    </>
  );
}
