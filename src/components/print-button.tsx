"use client";

import { PrinterIcon } from "@phosphor-icons/react";

/** "Print / PDF": the browser's print dialog, which also saves as PDF. */
export function PrintButton({ label = "Print / PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7 print:hidden">
      <PrinterIcon size={16} weight="duotone" />
      {label}
    </button>
  );
}
