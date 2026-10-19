import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth/current";
import type { MetricResult, MetricUnit } from "@/lib/domain/metrics";
import { SectionTabs } from "@/components/section-tabs";
import { AutoFilter } from "@/components/auto-filter";
import { Badge, Input, cx, type Tone } from "@/components/ui";
import { formatRupees } from "@/lib/format";

// Shared pieces of the Business Intelligence area (docs/BUSINESS-INTELLIGENCE.md §6): one header and tab strip for the
// six modules, metric tiles that carry their definition, the actual / estimate / forecast marks, and small charts drawn
// the way the dashboard draws its own (plain markup, no chart library).

export const INTELLIGENCE_TABS = [
  { href: "/intelligence", label: "Growth Engine" },
  { href: "/intelligence/recovery", label: "Revenue Recovery" },
  { href: "/intelligence/ltv", label: "Member Lifetime Value" },
  { href: "/intelligence/simulator", label: "Profit Simulator" },
  { href: "/intelligence/decisions", label: "Decision Simulator" },
  { href: "/intelligence/benchmarking", label: "Benchmarking" },
];

export function IntelligenceShell({ u, current, title, subtitle, actions, children }: { u: CurrentUser; current: string; title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const branch = u.branch === "ALL" ? "All branches" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");
  return (
    <div className="flex flex-col gap-6 pt-4">
      <div>
        <div className="text-[11px] tracking-[0.1em] text-muted uppercase">Business intelligence · {branch}</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] lg:text-[40px]">{title}</h1>
            {subtitle && <p className="mt-1.5 max-w-3xl text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
        </div>
      </div>
      <SectionTabs u={u} tabs={INTELLIGENCE_TABS} current={current} ruled className="-mt-2" label="Business intelligence modules" />
      {children}
    </div>
  );
}

const KIND_TONE: Record<string, Tone> = { actual: "ok", estimate: "accent", forecast: "neutral" };
const KIND_LABEL: Record<string, string> = { actual: "Actual", estimate: "Estimate", forecast: "Forecast" };

/** The mark every figure carries: read from the books, estimated from them, or forecast under assumptions. */
export const KindBadge = ({ kind }: { kind: string }) => <Badge tone={KIND_TONE[kind] ?? "neutral"}>{KIND_LABEL[kind] ?? kind}</Badge>;

export function fmtValue(value: number | null | undefined, unit: MetricUnit): string {
  if (value === null || value === undefined) return "—";
  switch (unit) {
    case "paise":
      return formatRupees(value);
    case "pct":
      return `${value}%`;
    case "months":
      return `${value} mo`;
    case "ratio":
      return `${value}×`;
    case "days":
      return `${value} d`;
    default:
      return value.toLocaleString("en-IN");
  }
}

/** A figure with its name, mark, and the definition behind a disclosure, so no number is shown without its meaning. */
export function MetricTile({ m, sub }: { m: MetricResult; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] tracking-[0.08em] text-muted uppercase">{m.name}</span>
        <KindBadge kind={m.kind} />
      </div>
      <span className={cx("text-[26px] leading-none font-semibold tabular-nums", m.value === null && "text-muted")}>{fmtValue(m.value as number | null, m.unit)}</span>
      {sub && <span className="text-[12px] text-muted">{sub}</span>}
      {m.warnings.length > 0 && (
        <ul className="m-0 list-none p-0 text-[12px] text-alert">
          {m.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <details className="text-[12px] text-muted">
        <summary className="cursor-pointer select-none">How it is worked out</summary>
        <p className="mt-1">{m.definition}</p>
        {m.assumptions.length > 0 && <p className="mt-1">Assumes: {m.assumptions.join(" ")}</p>}
        <p className="mt-1 text-faint">
          From {m.sources.join(", ")} · {m.period.from} to {m.period.to} · formula v{m.version} · INR, Asia/Kolkata
        </p>
      </details>
    </div>
  );
}

export const Tiles = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-3">{children}</div>;

/** Horizontal bars, one per row, scaled to the largest; money or counts. */
export function Bars({ rows, money, label }: { rows: { label: string; value: number; hint?: string; href?: string }[]; money?: boolean; label: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <p className="text-sm text-muted">Nothing to show yet.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(90px,160px)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate">{r.href ? <Link href={r.href} className="hover:text-accent">{r.label}</Link> : r.label}</span>
          <span className="h-3 overflow-hidden rounded-[2px] bg-fg/8" aria-hidden="true">
            <span className={cx("block h-full", r.value < 0 ? "bg-alert" : "bg-accent")} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
          </span>
          <span className="tabular-nums whitespace-nowrap" title={r.hint}>
            {money ? formatRupees(r.value) : r.value.toLocaleString("en-IN")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Columns of bars across months, as the dashboard's new-versus-renewal chart. */
export function Columns({ series, label, money }: { series: { label: string; value: number }[]; label: string; money?: boolean }) {
  const max = Math.max(1, ...series.map((s) => Math.abs(s.value)));
  return (
    <div className="flex h-[140px] items-end gap-1.5" role="img" aria-label={label}>
      {series.map((s) => (
        <div key={s.label} title={`${s.label}: ${money ? formatRupees(s.value) : s.value.toLocaleString("en-IN")}`} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
          <div className={cx("rounded-t-[2px]", s.value < 0 ? "bg-alert" : "bg-accent")} style={{ height: `${(Math.abs(s.value) / max) * 100}%` }} />
          <div className="truncate text-center text-[10px] text-muted">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/** From / to dates that apply themselves, keeping the other query parameters. */
export function PeriodFilter({ from, to, keep = {}, children }: { from: string; to: string; keep?: Record<string, string | undefined>; children?: ReactNode }) {
  return (
    <AutoFilter className="flex flex-wrap items-center gap-2.5">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <span className="text-[13px] text-muted">From</span>
      <Input type="date" name="from" aria-label="From date" defaultValue={from} className="w-auto!" />
      <span className="text-[13px] text-muted">to</span>
      <Input type="date" name="to" aria-label="To date" defaultValue={to} className="w-auto!" />
      {children}
    </AutoFilter>
  );
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** A period from the query, defaulting to the month to date; a from after to is swapped. */
export function periodFromQuery(sp: Record<string, string | string[] | undefined>, today: string, dflt?: { from: string; to: string }) {
  const s = (k: string) => (typeof sp[k] === "string" && ISO.test(sp[k] as string) ? (sp[k] as string) : undefined);
  let from = s("from") ?? dflt?.from ?? `${today.slice(0, 7)}-01`;
  let to = s("to") ?? dflt?.to ?? today;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

export const Level = ({ level }: { level: string }) => <Badge tone={level === "HIGH" ? "alert" : level === "MEDIUM" ? "accent" : "neutral"}>{level.charAt(0) + level.slice(1).toLowerCase()}</Badge>;

/** The standing note under every simulator figure. */
export const SIM_NOTE = "A forecast from the assumptions above, not a result. GST is shown apart and never counted as income; depreciation, loan interest and the owner's drawings are left out unless entered as costs. Nothing here changes the books.";
