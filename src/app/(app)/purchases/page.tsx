import Link from "next/link";
import { DownloadSimpleIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { ACCOUNTING_TABS, SectionTabs } from "@/components/section-tabs";
import { listPurchases } from "@/lib/services/purchases";
import { todayIso, toIso } from "@/lib/services/time";
import { monthLabel, monthsBack } from "@/lib/domain/periods";
import { AutoFilter } from "@/components/auto-filter";
import { Tag } from "@/components/tag";
import { LinkButton, ListHeader, Select, TABLE, TD, TH, cx, ScrollRegion } from "@/components/ui";
import { fmtDate, formatInr, formatRupees } from "@/lib/format";

export const metadata = { title: "Purchases · Fitron" };

const FILTERS = [
  ["All", "All"],
  ["STOCK", "Stock"],
  ["ASSET", "Assets"],
  ["EXPENSE", "Expenses"],
  ["Unpaid", "Unpaid"],
  ["Cancelled", "Cancelled"],
] as const;
const KIND: Record<string, string> = { STOCK: "Stock", ASSET: "Asset", EXPENSE: "Expense" };
/** Whole rupees, unless paise are left over (a 24-paise balance must not read ₹0). */
const money = (paise: number) => (paise % 100 ? formatInr(paise) : formatRupees(paise));
const btn2 = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7";

export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const u = await requirePermission("purchases.manage");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const months = monthsBack(today, 12);
  const month = months.includes(s("month") ?? "") ? s("month")! : "All";
  const f = FILTERS.some(([k]) => k === s("f")) ? s("f")! : "All";
  const [active, cancelled] = await Promise.all([listPurchases(u, {}), f === "Cancelled" ? listPurchases(u, { show: "cancelled" }) : Promise.resolve([])]);
  const rows = (f === "Cancelled" ? cancelled : active).filter(
    (p) => (month === "All" || toIso(p.date).startsWith(month)) && (f === "All" || f === "Cancelled" || (f === "Unpaid" ? p.balance > 0 : p.lines.some((l) => l.type === f))),
  );
  const now = active.filter((p) => toIso(p.date).startsWith(thisMonth));
  const typed = (t: string) => now.reduce((a, p) => a + p.lines.filter((l) => l.type === t).reduce((b, l) => b + l.amount, 0), 0);
  const unpaid = active.filter((p) => p.balance > 0);
  const kpis: [string, string, string][] = [
    ["This month", formatRupees(now.reduce((a, p) => a + p.total, 0)), `${now.length} bill${now.length === 1 ? "" : "s"}`],
    ["Stock bought", formatRupees(typed("STOCK")), "into POS inventory"],
    ["Assets bought", formatRupees(typed("ASSET")), "capitalised"],
    ["Payables outstanding", formatRupees(unpaid.reduce((a, p) => a + p.balance, 0)), `${unpaid.length} unpaid bill${unpaid.length === 1 ? "" : "s"}`],
  ];
  const href = (k: string) => {
    const q = new URLSearchParams({ ...(month !== "All" && { month }), ...(k !== "All" && { f: k }) }).toString();
    return q ? `/purchases?${q}` : "/purchases";
  };
  const branchLabel = u.branch === "ALL" ? "All branches (consolidated)" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");

  return (
    <div className="flex flex-col gap-7">
      <ListHeader kicker={branchLabel} title="Accounting" />
      <SectionTabs u={u} className="mb-0" tabs={ACCOUNTING_TABS} current="/purchases" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <AutoFilter>
            {f !== "All" && <input type="hidden" name="f" value={f} />}
            <Select name="month" defaultValue={month} aria-label="Month" className="w-auto!">
              <option value="All">All months</option>
              {[...months].reverse().map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </Select>
          </AutoFilter>
          <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-line">
            {FILTERS.map(([k, label]) => (
              <Link key={k} href={href(k)} className={cx("px-3 py-[7px] text-[13px]", k === f ? "bg-accent text-accent-ink" : "hover:bg-fg/7")}>
                {label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/purchases/csv${month !== "All" ? `?month=${month}` : ""}`} className={btn2}>
            <DownloadSimpleIcon size={16} weight="duotone" />
            CSV
          </a>
          <LinkButton href="/purchases/new" variant="primary">
            <PlusIcon size={16} weight="duotone" />
            New purchase
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

      <ScrollRegion label="Purchases table">
        <table className={TABLE}>
          <thead>
            <tr>
              {["Date", "Vendor", "Items", "Type", "Total", "Paid", "Balance", "Status", ""].map((h, i) => (
                <th key={i} className={cx(TH, i >= 4 && i <= 6 && "text-right")}>
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-fg/4">
                <td className={cx(TD, "whitespace-nowrap")}>
                  {fmtDate(p.date)}
                  <div className="text-xs text-muted">{p.code}</div>
                </td>
                <td className={cx(TD, "whitespace-nowrap")}>
                  <Link href={`/purchases/${p.id}`} className="font-semibold hover:text-accent">
                    {p.vendor}
                  </Link>
                  <div className="text-xs text-muted">
                    Bill {p.billNo ?? "—"}
                    {u.branchIds.length > 1 ? ` · ${p.branch.name}` : ""}
                  </div>
                </td>
                <td className={cx(TD, "max-w-[280px]")}>{p.lines.map((l) => `${l.description}${l.qty > 1 ? ` ×${l.qty}` : ""}`).join(", ")}</td>
                <td className={cx(TD, "whitespace-nowrap")}>{[...new Set(p.lines.map((l) => KIND[l.type] ?? l.type))].join(" · ")}</td>
                <td className={cx(TD, "text-right whitespace-nowrap")}>{money(p.total)}</td>
                <td className={cx(TD, "text-right whitespace-nowrap")}>{money(p.paid)}</td>
                <td className={cx(TD, "text-right font-semibold whitespace-nowrap")}>{money(p.balance)}</td>
                <td className={TD}>
                  {p.status === "CANCELLED" ? (
                    <Tag label="Cancelled" />
                  ) : p.balance <= 0 ? (
                    <Tag label="PAID">Paid</Tag>
                  ) : p.paid > 0 ? (
                    <Tag label="PARTIALLY PAID">Part paid</Tag>
                  ) : (
                    <Tag label="UNPAID">Unpaid</Tag>
                  )}
                </td>
                <td className={cx(TD, "text-right")}>
                  {p.status === "ACTIVE" && p.balance > 0 && (
                    <Link href={`/purchases/${p.id}#pay`} className="inline-flex items-center rounded-md px-2 py-1 text-[13px] font-semibold text-accent hover:bg-accent/10">
                      Pay
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {!rows.length && <div className="text-sm text-muted">No purchases match. Record supplier bills here; stock lines go straight into POS inventory and asset lines into the fixed-asset register.</div>}
    </div>
  );
}
