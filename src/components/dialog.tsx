import Link from "next/link";
import type { ReactNode } from "react";
import { XIcon } from "@phosphor-icons/react/dist/ssr";
import { Notice } from "./ui";

const btn = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border px-[18px] text-sm font-semibold whitespace-nowrap";

/** The prototype's modal: a card over a dimmed page; clicking outside closes it. Opened by a URL param, closed by a link. */
export function Dialog({ kicker, title, note, close, error, width = 480, form, children }: { kicker: string; title: string; note?: string; close: string; error?: string; width?: number; form?: boolean; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-auto p-5 max-lg:items-end max-lg:p-0">
      <Link href={close} aria-label="Close" className="absolute inset-0 bg-[color-mix(in_srgb,var(--text)_8%,rgba(0,0,0,0.6))]" scroll={false} />
      <div role="dialog" aria-modal="true" style={{ width: `min(${width}px, 100%)` }} className={`relative flex max-h-[92vh] flex-col gap-3.5 overflow-auto rounded-lg p-5 ${form ? "bg-bg" : "bg-surface"} shadow-lg max-lg:rounded-t-[18px] max-lg:rounded-b-none`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] tracking-[0.1em] text-muted uppercase">{kicker}</div>
            <div className={form ? "text-[26px] leading-[1.2] font-semibold" : "text-xl font-semibold"}>{title}</div>
          </div>
          {form && (
            <Link href={close} aria-label="Close" scroll={false} className="grid size-9 flex-none place-items-center rounded-md hover:bg-fg/7">
              <XIcon size={18} weight="duotone" />
            </Link>
          )}
        </div>
        {error && <Notice tone="alert">{error}</Notice>}
        {children}
        {note && <p className="m-0 text-[13px] text-muted">{note}</p>}
      </div>
    </div>
  );
}

export const DialogButtons = ({ close, label, cancelLabel = "Cancel", danger }: { close: string; label: string; cancelLabel?: string; danger?: boolean }) => (
  <div className="flex justify-end gap-2.5">
    <Link href={close} className={`${btn} border-line hover:bg-fg/7`} scroll={false}>
      {cancelLabel}
    </Link>
    <button className={`${btn} border-transparent ${danger ? "bg-alert-700 text-white hover:opacity-90" : "bg-accent text-accent-ink hover:bg-accent-hover"}`}>{label}</button>
  </div>
);
