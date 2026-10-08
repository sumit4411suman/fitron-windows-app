"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FunnelIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { ScrollRegion, TABLE, TD, TH, cx } from "@/components/ui";

type Cell = string | number | null;
type Col = { key: string; label: string; money?: boolean };

const fmt = (v: Cell, money?: boolean) =>
  v == null || v === "" ? "—" : money && typeof v === "number" ? `${v < 0 ? "−" : ""}₹${(Math.abs(v) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : typeof v === "number" ? v.toLocaleString("en-IN") : v;

/** The report list, with "Find a report". */
export function ReportNav({ groups, current, qs }: { groups: { title: string; items: { key: string; title: string }[] }[]; current: string; qs: string }) {
  const [find, setFind] = useState("");
  const f = find.trim().toLowerCase();
  return (
    <nav aria-label="Reports" className="sticky top-4 flex max-h-[calc(100vh-110px)] w-[250px] flex-none flex-col gap-3.5 overflow-auto rounded-lg bg-surface p-3.5">
      <div className="relative">
        <MagnifyingGlassIcon size={16} weight="duotone" className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a report" aria-label="Find a report" className="min-h-9 w-full rounded-md border border-line bg-bg py-1.5 pr-2.5 pl-9 text-fg placeholder:text-fg/65 focus:border-accent focus:outline-none" />
      </div>
      {groups.map((g) => {
        const items = g.items.filter((i) => !f || i.title.toLowerCase().includes(f));
        if (!items.length) return null;
        return (
          <div key={g.title} className="flex flex-col gap-0.5">
            <div className="px-2.5 py-1 text-[10px] tracking-[0.12em] text-accent uppercase">{g.title}</div>
            {items.map((i) => (
              <Link key={i.key} href={`/reports?r=${i.key}${qs}`} className={cx("rounded-md px-2.5 py-2 text-sm", i.key === current ? "bg-accent-soft text-accent-strong" : "hover:bg-accent-soft")}>
                {i.title}
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

/** Rows with "Filter rows" and click-to-sort columns, as in the prototype. */
export function ReportTable({ columns, rows, totals }: { columns: Col[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell> }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    let r = t ? rows.filter((row) => columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(t))) : rows;
    if (sort) r = [...r].sort((a, b) => ((a[sort.key] ?? "") > (b[sort.key] ?? "") ? 1 : (a[sort.key] ?? "") < (b[sort.key] ?? "") ? -1 : 0) * sort.dir);
    return r;
  }, [rows, columns, q, sort]);
  const right = (c: Col) => c.money || typeof rows[0]?.[c.key] === "number";
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 print:hidden">
        <div className="relative max-w-[340px] flex-1">
          <FunnelIcon size={16} weight="duotone" className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter rows" aria-label="Filter rows" className="min-h-9 w-full rounded-md border border-line bg-bg py-1.5 pr-2.5 pl-9 text-fg placeholder:text-fg/65 focus:border-accent focus:outline-none" />
        </div>
        <span className="text-[13px] text-muted">{shown.length} rows · click a column to sort</span>
      </div>
      <ScrollRegion both label="Report" className="max-h-[640px] max-w-full">
        <table className={cx(TABLE, "m-0")}>
          <thead className="sticky top-0 z-[1] bg-surface">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key ? (-s.dir as 1 | -1) : 1 }))}
                  className={cx(TH, "cursor-pointer pl-5", right(c) && "text-right")}
                >
                  {c.label}
                  {sort?.key === c.key && <span className="text-accent">{sort.dir > 0 ? " ↑" : " ↓"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} className="hover:bg-accent-soft">
                {columns.map((c) => (
                  <td key={c.key} className={cx(TD, "pl-5 whitespace-nowrap tabular-nums", right(c) && "text-right", typeof row[c.key] === "number" && (row[c.key] as number) < 0 && "text-alert-700")}>
                    {fmt(row[c.key] ?? null, c.money)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && !q && shown.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                {columns.map((c, i) => (
                  <td key={c.key} className={cx(TD, "pl-5 whitespace-nowrap tabular-nums", right(c) && "text-right")}>
                    {i === 0 ? "Total" : totals[c.key] == null ? "" : fmt(totals[c.key]!, c.money)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {shown.length === 0 && <p className="px-5 py-4 text-sm text-muted">Nothing to show.</p>}
      </ScrollRegion>
    </>
  );
}
