"use client";

import Link from "next/link";
import { useTransition } from "react";
import { PhoneIcon, WhatsappLogoIcon, XIcon } from "@phosphor-icons/react";
import type { LeadStage } from "@/lib/validation/frontdesk";
import { advanceLeadAction, loseLeadAction, touchLeadAction } from "./actions";

const NEXT_LABEL: Partial<Record<LeadStage, string>> = { New: "Mark contacted", Contacted: "Book trial", "Trial booked": "Trial done" };

const icon = "grid size-8 place-items-center rounded-md text-accent hover:bg-accent/10 disabled:opacity-45";
const small = "inline-flex items-center rounded-md px-2.5 py-[5px] text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-45";

/** Call, WhatsApp, next stage, Join and Lost for one lead, as on the prototype's board. */
export function LeadActions({ id, stage, phone, message, showLose = true, card = false }: { id: string; stage: LeadStage; phone: string; message: string; showLose?: boolean; card?: boolean }) {
  const [pending, start] = useTransition();
  const digits = phone.replace(/\D/g, "").slice(-10);
  const next = NEXT_LABEL[stage];
  const open = stage !== "Won" && stage !== "Lost";
  if (!open) return null;
  return (
    <span className={card ? "flex w-full items-center gap-1.5" : "inline-flex items-center gap-1"}>
      <button
        type="button"
        className={`${icon} ${card ? "size-[34px]!" : ""}`}
        title="Call"
        aria-label="Call"
        disabled={pending}
        onClick={() => {
          window.location.href = `tel:+91${digits}`;
          start(() => touchLeadAction(id, "call"));
        }}
      >
        <PhoneIcon weight="duotone" />
      </button>
      <button
        type="button"
        className={`${icon} ${card ? "size-[34px]!" : ""}`}
        title="WhatsApp"
        aria-label="WhatsApp"
        disabled={pending}
        onClick={() => {
          window.open(`https://wa.me/91${digits}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
          start(() => touchLeadAction(id, "whatsapp"));
        }}
      >
        <WhatsappLogoIcon weight="duotone" />
      </button>
      {card && <span className="flex-1" />}
      {next && (
        <button type="button" disabled={pending} onClick={() => start(() => advanceLeadAction(id, stage))} className={`${small} border border-line hover:bg-fg/7`}>
          {next}
        </button>
      )}
      <Link href={`/members/new?lead=${id}`} className={`${small} bg-accent text-accent-ink hover:bg-accent-hover`}>
        Join
      </Link>
      {showLose && (
        <button
          type="button"
          className={`${icon} ${card ? "size-[34px]!" : ""} text-alert-700 hover:bg-alert-soft`}
          title="Mark lost"
          aria-label="Mark lost"
          disabled={pending}
          onClick={() => {
            const reason = window.prompt("Mark lead as lost? The lead stays in reports under Lost.\n\nReason:");
            if (reason?.trim()) start(async () => void (await loseLeadAction(id, reason.trim())));
          }}
        >
          <XIcon weight="duotone" />
        </button>
      )}
    </span>
  );
}
