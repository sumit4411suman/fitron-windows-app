"use client";

import { useState, useSyncExternalStore } from "react";
import { DownloadSimpleIcon, PrinterIcon } from "@phosphor-icons/react";
import { PAPERS, type Paper } from "@/lib/pdf/paper";

const CHANGED = "fitron-paper";
const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
};
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * Prints a document as a PDF made for the paper chosen (A4, A5, 80 mm or 58 mm), not as a printout of the screen. The
 * PDF opens in its own window and prints at its own size on whatever printer Windows has (docs/local-windows/PRINTING.md).
 * The last paper chosen for each kind of document is remembered on this computer.
 */
export function PaperPrint({ href, kind, label, papers, fallback, compact }: { href: string; kind: "invoice" | "receipt"; label: string; papers: Paper[]; fallback: Paper; compact?: boolean }) {
  const key = `fitron-paper-${kind}`;
  const saved = useSyncExternalStore(subscribe, () => read(key), () => null) as Paper | null;
  // Kept for this page too, for a browser that cannot remember it.
  const [picked, setPicked] = useState<Paper | null>(null);
  const paper = picked ?? (saved && papers.includes(saved) ? saved : fallback);
  const choose = (p: Paper) => {
    setPicked(p);
    try {
      localStorage.setItem(key, p);
    } catch {
      // No storage (private window): this choice is not remembered.
    }
    window.dispatchEvent(new Event(CHANGED));
  };
  const url = `${href}?paper=${paper}`;
  const btn = compact
    ? "inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold hover:bg-fg/7"
    : "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 print:hidden">
      <a href={url} target="_blank" rel="noopener" className={btn}>
        <PrinterIcon size={compact ? 14 : 16} weight="duotone" />
        {label}
      </a>
      <select aria-label={`${label}: paper`} value={paper} onChange={(e) => choose(e.target.value as Paper)} className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs">
        {papers.map((p) => (
          <option key={p} value={p}>
            {PAPERS[p].label}
          </option>
        ))}
      </select>
      {!compact && (
        <a href={`${url}&download=1`} className={btn} aria-label={`Save ${kind} as PDF`}>
          <DownloadSimpleIcon size={16} weight="duotone" />
          PDF
        </a>
      )}
    </span>
  );
}

/** A payment's receipt, on the receipt paper last chosen on this computer (80 mm unless one was). For tables. */
export function ReceiptLink({ paymentId, code }: { paymentId: string; code: string }) {
  const saved = useSyncExternalStore(subscribe, () => read("fitron-paper-receipt"), () => null) as Paper | null;
  const paper = saved && saved in PAPERS ? saved : "80mm";
  return (
    <a href={`/payments/${paymentId}/receipt?paper=${paper}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline" aria-label={`Receipt ${code}`}>
      <PrinterIcon size={14} weight="duotone" />
      Receipt
    </a>
  );
}
