"use client";

import { useId, type ReactNode } from "react";

// Small building blocks shared by the calculators: a labelled number box, a choice, and the result panel.

export const inr = (n: number, digits = 0) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function NumField({ label, value, onChange, unit, help, step = "any" }: { label: string; value: string; onChange: (v: string) => void; unit?: string; help?: string; step?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input id={id} type="number" inputMode="decimal" min="0" step={step} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={help ? `${id}-h` : undefined} className="w-full rounded-md border border-line bg-surface px-3" />
        {unit && <span className="shrink-0 text-sm text-muted">{unit}</span>}
      </div>
      {help && (
        <p id={`${id}-h`} className="text-xs text-muted">
          {help}
        </p>
      )}
    </div>
  );
}

export function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className="w-full rounded-md border border-line bg-surface px-3">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

/** The answer. Announced politely as it changes; shows what is wrong with the numbers instead of a result when they are not usable. */
export function Result({ error, children }: { error: string | null; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="s-card s-solid p-5">
      {error ? <p className="text-sm text-muted">{error}</p> : children}
    </div>
  );
}

export function Row({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0 ${strong ? "text-lg font-bold" : ""}`}>
      <dt className={strong ? "" : "text-muted"}>{k}</dt>
      <dd className="text-right tabular-nums">{v}</dd>
    </div>
  );
}
