"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FunnelIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { ScrollRegion, cx } from "@/components/ui";
import { formatRupees } from "@/lib/format";

type Col = { key: string; label: string; money?: boolean; kind?: "num" | "pct" };
type Cell = string | number | null;
type Group = { group: string; items: { key: string; title: string }[] };

/** The report centre's left list: "Find a report", favourites first, then the prototype's groups. */
export function ReportNav({ groups, current, href }: { groups: Group[]; current: string; href: Record<string, string> }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  return (
    <nav aria-label="Reports" className="sticky top-[84px] flex max-h-[calc(100vh-110px)] w-[250px] flex-none flex-col gap-3.5 overflow-auto rounded-lg bg-surface p-3.5 max-lg:hidden print:hidden">
      <div className="relative">
        <MagnifyingGlassIcon size={16} weight="duotone" className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a report" aria-label="Find a report" className="min-h-9 w-full rounded-md border border-line bg-surface py-1.5 pr-2.5 pl-9 text-fg placeholder:text-fg/65 focus:border-accent focus:outline-none" />
      </div>
      {groups.map((g) => {
        const items = g.items.filter((i) => !ql || i.title.toLowerCase().includes(ql));
        if (!items.length) return null;
        return (
          <div key={g.group} className="flex flex-col gap-0.5">
            <div className="px-2.5 py-1 text-[10px] tracking-[0.12em] text-accent uppercase">{g.group}</div>
            {items.map((i) => (
              <Link key={i.key} href={href[i.key]!} className={cx("rounded-md px-2.5 py-2 text-sm hover:bg-accent-soft", i.key === current && "bg-accent-soft text-accent-strong")}>
                {i.title}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

const fmt = (c: Col, v: Cell) => (v == null || v === "" ? "—" : c.money && typeof v === "number" ? formatRupees(v) : c.kind === "pct" && typeof v === "number" ? `${Math.round(v * 10) / 10}%` : c.kind === "num" && typeof v === "number" ? v.toLocaleString("en-IN") : String(v));
const right = (c: Col) => !!c.money || !!c.kind;

/** "Filter rows" and click-a-column-to-sort over the report's rows, as in the prototype. */
export function ReportTable({ columns, rows, totals }: { columns: Col[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell> }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = ql ? rows.filter((r) => columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(ql))) : rows;
    if (sort) out = [...out].sort((a, b) => {
      const x = a[sort.k] ?? "";
      const y = b[sort.k] ?? "";
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en-IN", { numeric: true })) * sort.dir;
    });
    return out;
  }, [rows, columns, q, sort]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 print:hidden">
        <div className="relative max-w-[340px] flex-1">
          <FunnelIcon size={16} weight="duotone" className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter rows" aria-label="Filter rows" className="min-h-9 w-full rounded-md border border-line bg-surface py-1.5 pr-2.5 pl-9 text-fg placeholder:text-fg/65 focus:border-accent focus:outline-none" />
        </div>
        <span className="text-[13px] text-muted">
          {shown.length} rows · click a column to sort
        </span>
      </div>
      <ScrollRegion both label="Report" id="report-print" className="max-h-[640px] max-w-full print:max-h-none">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-[1] bg-surface">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => setSort((s) => (s?.k === c.key ? { k: c.key, dir: s.dir === 1 ? -1 : 1 } : { k: c.key, dir: 1 }))}
                  className={cx("cursor-pointer border-b border-line py-2.5 pr-2.5 pl-5 text-[11px] font-normal tracking-[0.08em] whitespace-nowrap text-fg/60 uppercase select-none", right(c) ? "text-right" : "text-left")}
                >
                  {c.label}
                  {sort?.k === c.key && <span className="text-accent">{sort.dir === 1 ? " ↑" : " ↓"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="hover:bg-accent-soft">
                {columns.map((c) => {
                  const v = r[c.key] ?? null;
                  return (
                    <td key={c.key} className={cx("border-b border-line-soft py-2.5 pr-2.5 pl-5 whitespace-nowrap tabular-nums", right(c) && "text-right", typeof v === "number" && v < 0 && "text-alert-700")}>
                      {fmt(c, v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {totals && !q && (
            <tfoot>
              <tr className="font-semibold">
                {columns.map((c, i) => (
                  <td key={c.key} className={cx("border-t border-line py-2.5 pr-2.5 pl-5 whitespace-nowrap tabular-nums", right(c) && "text-right")}>
                    {i === 0 ? "Total" : totals[c.key] != null ? fmt(c, totals[c.key]!) : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {!shown.length && <p className="px-5 py-6 text-sm text-muted">Nothing to show.</p>}
      </ScrollRegion>
    </>
  );
}
