import Link from "next/link";
import { DownloadSimpleIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { ACCOUNTING_TABS, SectionTabs } from "@/components/section-tabs";
import { listAssets } from "@/lib/services/assets";
import { monthLabel } from "@/lib/domain/periods";
import { Tag } from "@/components/tag";
import { LinkButton, ListHeader, TABLE, TD, TH, cx, ScrollRegion } from "@/components/ui";
import { fmtDate, formatRupees } from "@/lib/format";
import { todayIso } from "@/lib/services/time";
import { ASSET_STATUS } from "./tone";

export const metadata = { title: "Fixed assets · Fitron" };

const FILTERS = [
  ["IN_USE", "In use"],
  ["SOLD", "Sold"],
  ["SCRAPPED", "Scrapped"],
  ["all", "All"],
] as const;
/** Status chips as the prototype colours them: gold for in use, gold outline for sold, grey for scrapped. */
const STATUS_TAG: Record<string, string> = { IN_USE: "Active", SOLD: "Delivered", SCRAPPED: "Scrapped" };

export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const u = await requirePermission("assets.manage");
  const sp = await searchParams;
  const status = FILTERS.some(([k]) => k === sp.status) ? (sp.status as string) : "IN_USE";
  const [rows, all] = await Promise.all([listAssets(u, { status: status === "all" ? undefined : status }), listAssets(u, { status: "IN_USE" })]);
  const today = todayIso();
  const gross = all.reduce((s, a) => s + a.cost, 0);
  const acc = all.reduce((s, a) => s + a.info.acc, 0);
  const kpis: [string, string, string][] = [
    ["Gross block", formatRupees(gross), `${all.length} asset${all.length === 1 ? "" : "s"} in use`],
    ["Accumulated depreciation", formatRupees(acc), `to ${monthLabel(today)}`],
    ["Net book value", formatRupees(gross - acc), "what the equipment is worth on the books"],
    ["Depreciation this FY", formatRupees(all.reduce((s, a) => s + a.info.fyDep, 0)), "charged to P&L"],
  ];
  const branchLabel = u.branch === "ALL" ? "All branches (consolidated)" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");

  return (
    <div className="flex flex-col gap-7">
      <ListHeader kicker={branchLabel} title="Accounting" />
      <SectionTabs u={u} className="mb-0" tabs={ACCOUNTING_TABS} current="/assets" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-line">
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={k === "IN_USE" ? "/assets" : `/assets?status=${k}`} className={cx("px-3 py-[7px] text-[13px]", k === status ? "bg-accent text-accent-ink" : "hover:bg-fg/7")}>
              {label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/reports/assets/csv" prefetch={false}>
            <DownloadSimpleIcon size={16} weight="duotone" />
            Register CSV
          </LinkButton>
          <LinkButton href="/assets/new" variant="primary">
            <PlusIcon size={16} weight="duotone" />
            Add asset
          </LinkButton>
        </div>
      </div>

      <div className="grid gap-x-10 gap-y-7 [grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))]">
        {kpis.map(([k, v, sub]) => (
          <div key={k}>
            <div className="text-xs tracking-[0.06em] text-muted uppercase">{k}</div>
            <div className="mt-1 text-[30px] leading-[1.15] font-semibold">{v}</div>
            <div className="mt-0.5 text-[13px] text-muted">{sub}</div>
          </div>
        ))}
      </div>

      <ScrollRegion label="Assets table">
        <table className={TABLE}>
          <thead>
            <tr>
              {["Asset", "Category", "Purchased", "Cost", "Depreciation", "This FY", "Accumulated", "Book value", "Status", ""].map((h, i) => (
                <th key={i} className={cx(TH, [3, 5, 6, 7].includes(i) && "text-right")}>
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-fg/4">
                <td className={cx(TD, "whitespace-nowrap")}>
                  <Link href={`/assets/${a.id}`} className="font-semibold hover:text-accent">
                    {a.name}
                    {a.qty > 1 ? ` ×${a.qty}` : ""}
                  </Link>
                  <div className="text-xs text-muted">
                    {a.code} · {a.vendor ?? "—"}
                    {u.branchIds.length > 1 ? ` · ${a.branch.name}` : ""}
                  </div>
                </td>
                <td className={cx(TD, "whitespace-nowrap")}>{a.category}</td>
                <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(a.purchaseDate)}</td>
                <td className={cx(TD, "text-right whitespace-nowrap")}>{formatRupees(a.cost)}</td>
                <td className={cx(TD, "whitespace-nowrap")}>{a.method === "SLM" ? `SLM · ${a.life} yrs` : `WDV · ${Number(a.rate)}%`}</td>
                <td className={cx(TD, "text-right whitespace-nowrap")}>{formatRupees(a.info.fyDep)}</td>
                <td className={cx(TD, "text-right whitespace-nowrap")}>{formatRupees(a.info.acc)}</td>
                <td className={cx(TD, "text-right font-semibold whitespace-nowrap")}>{formatRupees(a.info.nbv)}</td>
                <td className={TD}>
                  <Tag label={STATUS_TAG[a.status] ?? a.status}>{ASSET_STATUS[a.status] ?? a.status}</Tag>
                </td>
                <td className={cx(TD, "text-right")}>
                  {a.status === "IN_USE" && (
                    <Link href={`/assets/${a.id}#dispose`} className="inline-flex items-center rounded-md px-2 py-1 text-[13px] font-semibold text-accent hover:bg-accent/10">
                      Dispose
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {!rows.length && <div className="text-sm text-muted">No assets with this status.</div>}
    </div>
  );
}
