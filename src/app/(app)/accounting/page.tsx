import Link from "next/link";
import { DownloadSimpleIcon, LockSimpleIcon, LockSimpleOpenIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { ACCOUNTING_TABS, SectionTabs } from "@/components/section-tabs";
import { LEDGERS, ledger, ledgerTable, monthClose, reconciliation, type LedgerKind } from "@/lib/services/accounting";
import { getSetting } from "@/lib/services/settings";
import { db } from "@/lib/db";
import { todayIso } from "@/lib/services/time";
import { isPeriod, monthLabel, monthsBack, periodRange } from "@/lib/domain/periods";
import { AutoFilter } from "@/components/auto-filter";
import { ConfirmButton } from "@/components/confirm-button";
import { PrintButton } from "@/components/print-button";
import { Tag } from "@/components/tag";
import { Input, ListHeader, Notice, ScrollRegion, Select, TABLE, TD, TH, cx } from "@/components/ui";
import { fmtDate, formatRupees } from "@/lib/format";
import { METHODS } from "@/lib/validation/billing";
import { lock, unlock } from "./actions";

export const metadata = { title: "Accounting · Fitron" };

type U = Awaited<ReturnType<typeof requirePermission>>;
const P_TABS = [
  ["month", "This month"],
  ["last", "Last month"],
  ["quarter", "This quarter"],
  ["year", "This FY"],
  ["custom", "Custom"],
] as const;
/** Invoice line categories under the prototype's revenue headings. */
const REVENUE: Record<string, string> = {
  "New Membership": "Membership revenue",
  Renewal: "Renewal revenue",
  "Personal Training": "Personal training",
  Registration: "Registration fees",
  Product: "Product sales",
};
const REV_ORDER = ["Membership revenue", "Renewal revenue", "Personal training", "Registration fees", "Product sales", "Other revenue", "Gain on sale of assets"];
const LEDGER_LABEL: Record<LedgerKind | "cash", string> = { income: "Income", expense: "Expense", payment: "Payment", receivable: "Receivable", cash: "Cash & bank book" };
const btn2 = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7";
const seg = (on: boolean) => cx("px-3 py-[7px] text-[13px]", on ? "bg-accent text-accent-ink" : "hover:bg-fg/7");

export default async function AccountingPage({ searchParams }: PageProps<"/accounting">) {
  const u = await requirePermission("accounting.view");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const tab = s("tab") === "ledger" ? "ledger" : s("tab") === "close" || s("tab") === "months" ? "close" : "pl";
  const branchLabel = u.branch === "ALL" ? "All branches (consolidated)" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");
  const current = tab === "pl" ? "/accounting" : `/accounting?tab=${tab}`;

  return (
    <div className="flex flex-col gap-7">
      <ListHeader kicker={branchLabel} title="Accounting" />
      <SectionTabs u={u} className="mb-0" tabs={ACCOUNTING_TABS} current={current} />
      {s("msg") && <Notice tone="ok">{s("msg")}</Notice>}
      {s("error") && <Notice tone="alert">{s("error")}</Notice>}
      {tab === "pl" && <ProfitLoss u={u} s={s} branchLabel={branchLabel} />}
      {tab === "ledger" && <Ledgers u={u} s={s} />}
      {tab === "close" && <Close u={u} s={s} />}
    </div>
  );
}

const Line = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (
  <div className={cx("flex justify-between py-[5px] text-[15px]", bold && "font-semibold")}>
    <span>{k}</span>
    <span className="tabular-nums">{v}</span>
  </div>
);

async function ProfitLoss({ u, s, branchLabel }: { u: U; s: (k: string) => string | undefined; branchLabel: string }) {
  const today = todayIso();
  const key = isPeriod(s("p")) && P_TABS.some(([k]) => k === s("p")) ? s("p")! : "month";
  const period = periodRange(key as Parameters<typeof periodRange>[0], today, s("from"), s("to"));
  const [{ pl, rows }, gym] = await Promise.all([reconciliation(u, period), getSetting<{ name?: string }>(u.orgId, "gym")]);
  const rev = new Map<string, number>();
  for (const r of pl.revenue) {
    const label = REVENUE[r.key] ?? "Other revenue";
    rev.set(label, (rev.get(label) ?? 0) + r.amount);
  }
  if (pl.disposalGain) rev.set("Gain on sale of assets", pl.disposalGain);
  const revenue = REV_ORDER.filter((k) => rev.get(k)).map((k) => [k, rev.get(k)!] as const);
  const expenses = [...pl.expenseGroups.map((g) => [g.key, g.amount] as const), ...(pl.depreciation ? [["Depreciation", pl.depreciation] as const] : []), ...(pl.disposalLoss ? [["Loss on disposal of assets", pl.disposalLoss] as const] : [])].sort((a, b) => b[1] - a[1]);
  const revTotal = pl.totalRevenue + pl.disposalGain;
  const expTotal = pl.totalExpenses + pl.depreciation + pl.disposalLoss;
  const q = (p: string) => (p === "month" ? "/accounting" : `/accounting?p=${p}`);
  const csv = `/accounting/csv?kind=pl&from=${period.from}&to=${period.to}`;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-line">
          {P_TABS.map(([k, label]) => (
            <Link key={k} href={q(k)} className={seg(k === key)}>
              {label}
            </Link>
          ))}
        </div>
        <div className="flex gap-2">
          <PrintButton />
          <a href={csv} className={btn2}>
            <DownloadSimpleIcon size={16} weight="duotone" />
            CSV
          </a>
        </div>
      </div>
      {key === "custom" && (
        <AutoFilter className="flex flex-wrap gap-3 print:hidden">
          <input type="hidden" name="p" value="custom" />
          <label className="flex flex-col gap-[5px] text-sm">
            <span className="text-xs text-fg/70">From</span>
            <Input type="date" name="from" defaultValue={period.from} className="w-auto!" />
          </label>
          <label className="flex flex-col gap-[5px] text-sm">
            <span className="text-xs text-fg/70">To</span>
            <Input type="date" name="to" defaultValue={period.to} className="w-auto!" />
          </label>
        </AutoFilter>
      )}
      <div className="grid gap-14 [grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))]">
        <section className="max-w-[560px]">
          <div className="text-[11px] tracking-[0.1em] text-muted uppercase">
            {gym?.name || u.orgName} · {branchLabel}
          </div>
          <h2 className="mt-1 mb-0.5 text-[28px]">Profit &amp; Loss</h2>
          <div className="mb-[22px] text-[13px] text-muted">
            {fmtDate(period.from)} to {fmtDate(period.to)}
          </div>
          <h5 className="mb-1.5 text-[13px] tracking-[0.08em] uppercase">Revenue</h5>
          {revenue.map(([k, v]) => (
            <Line key={k} k={k} v={formatRupees(v)} />
          ))}
          {!revenue.length && <p className="py-1 text-sm text-muted">No revenue in this period.</p>}
          <div className="mt-1 flex justify-between border-t border-fg py-2 font-semibold">
            <span>Total revenue</span>
            <span>{formatRupees(revTotal)}</span>
          </div>
          <h5 className="mt-[22px] mb-1.5 text-[13px] tracking-[0.08em] uppercase">Expenses</h5>
          {expenses.map(([k, v]) => (
            <Line key={k} k={k} v={formatRupees(v)} />
          ))}
          {!expenses.length && <p className="py-1 text-sm text-muted">No expenses in this period.</p>}
          <div className="mt-1 flex justify-between border-t border-fg py-2 font-semibold">
            <span>Total expenses</span>
            <span>{formatRupees(expTotal)}</span>
          </div>
          <div className={cx("mt-[18px] flex justify-between border-t-[3px] border-double border-fg py-3 text-[22px] font-semibold", pl.net < 0 && "text-alert-700")}>
            <span>{pl.net >= 0 ? "Net profit" : "Net loss"}</span>
            <span>{formatRupees(pl.net)}</span>
          </div>
        </section>
        <section className="print:hidden">
          <h3 className="mb-1.5 text-xl">Reconciliation</h3>
          <p className="mb-3.5 text-[13px] text-muted">Computed from invoices, payments and expenses in the same period.</p>
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-line-soft py-[7px] text-[15px]">
              <span>{k}</span>
              <span className="font-semibold">{formatRupees(v)}</span>
            </div>
          ))}
          <p className="mt-3 text-[12.5px] text-muted">Revenue is counted on the invoice date, collections on the payment date. Equipment bought is capitalised; its depreciation comes from the fixed-asset register.</p>
        </section>
      </div>
    </>
  );
}

async function Ledgers({ u, s }: { u: U; s: (k: string) => string | undefined }) {
  const kind = (LEDGERS as readonly string[]).includes(s("l") ?? "") ? (s("l") as LedgerKind) : s("l") === "cash" ? "cash" : "income";
  const tabs = (
    <div className="flex flex-wrap justify-between gap-3">
      <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-line">
        {([...LEDGERS, "cash"] as const).map((k) => (
          <Link key={k} href={`/accounting?tab=ledger&l=${k}`} className={seg(k === kind)}>
            {LEDGER_LABEL[k]}
          </Link>
        ))}
      </div>
      {kind !== "cash" && (
        <a href={`/accounting/csv?kind=${kind}`} className={btn2}>
          <DownloadSimpleIcon size={16} weight="duotone" />
          Export CSV
        </a>
      )}
    </div>
  );
  if (kind === "cash") return (
    <>
      {tabs}
      <CashBook u={u} s={s} />
    </>
  );
  const t = await ledgerTable(u, kind);
  const fmt = (v: string | number | Date, i: number) => (v instanceof Date ? fmtDate(v) : t.money.includes(i) ? (typeof v === "number" && v < 0 ? `(${formatRupees(-v)})` : formatRupees(v as number)) : String(v));
  return (
    <>
      {tabs}
      <ScrollRegion label={`${kind} ledger`}>
        <table className={TABLE}>
          <thead>
            <tr>
              {t.cols.map((c, i) => (
                <th key={c} className={cx(TH, t.money.includes(i) && "text-right")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, n) => (
              <tr key={n} className="hover:bg-fg/4">
                {r.map((v, i) => (
                  <td key={i} className={cx(TD, "whitespace-nowrap", t.money.includes(i) && "text-right")}>
                    {fmt(v, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <div className="text-[13px] text-muted">{t.note}</div>
    </>
  );
}

async function CashBook({ u, s }: { u: U; s: (k: string) => string | undefined }) {
  const today = todayIso();
  const method = METHODS.includes(s("method") as (typeof METHODS)[number]) ? s("method")! : "Cash";
  const period = { from: s("from") && /^\d{4}-\d{2}-\d{2}$/.test(s("from")!) ? s("from")! : `${today.slice(0, 7)}-01`, to: s("to") && /^\d{4}-\d{2}-\d{2}$/.test(s("to")!) ? s("to")! : today };
  const l = await ledger(u, method, period);
  return (
    <>
      <AutoFilter className="flex flex-wrap items-end gap-2.5">
        <input type="hidden" name="tab" value="ledger" />
        <input type="hidden" name="l" value="cash" />
        <Select name="method" defaultValue={method} aria-label="Method" className="w-auto!">
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
        <Input name="from" type="date" defaultValue={period.from} aria-label="From" className="w-auto!" />
        <Input name="to" type="date" defaultValue={period.to} aria-label="To" className="w-auto!" />
        <span className="ml-auto text-sm text-muted">
          In {formatRupees(l.totalIn)} · Out {formatRupees(l.totalOut)} · Closing <strong className="text-fg">{formatRupees(l.closing)}</strong>
        </span>
      </AutoFilter>
      {l.broughtForward !== null && <p className="text-sm">Brought forward on {fmtDate(period.from)}: {formatRupees(l.broughtForward)}</p>}
      <ScrollRegion label={`${method} movements`}>
        <table className={TABLE}>
          <thead>
            <tr>
              {["Date", "Ref", "Details", "In", "Out", "Running"].map((h, i) => (
                <th key={h} className={cx(TH, i >= 3 && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {l.rows.map((r, i) => (
              <tr key={i} className="hover:bg-fg/4">
                <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(r.date)}</td>
                <td className={TD}>{r.link ? <Link href={r.link} className="text-accent">{r.ref}</Link> : r.ref}</td>
                <td className={TD}>{r.text}</td>
                <td className={cx(TD, "text-right")}>{r.in ? formatRupees(r.in) : ""}</td>
                <td className={cx(TD, "text-right")}>{r.out ? formatRupees(r.out) : ""}</td>
                <td className={cx(TD, "text-right")}>{formatRupees(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {!l.rows.length && <div className="text-[13px] text-muted">No {method} movements in this period.</div>}
    </>
  );
}

async function Close({ u, s }: { u: U; s: (k: string) => string | undefined }) {
  const today = todayIso();
  const months = monthsBack(today, 13);
  const prev = months[months.length - 2]!;
  const ym = months.includes(s("m") ?? "") ? s("m")! : prev;
  const [c, locks, opening] = await Promise.all([
    monthClose(u, ym),
    db.monthLock.findMany({ where: { branchId: { in: u.branchIds } }, select: { month: true, branchId: true }, orderBy: { month: "asc" } }),
    getSetting<{ asOf?: string }>(u.orgId, "opening"),
  ]);
  const lockedMonths = [...new Set(locks.map((l) => l.month))].filter((m) => locks.filter((l) => l.month === m).length === u.branchIds.length);
  const label = monthLabel(ym);
  return (
    <>
      <AutoFilter className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="close" />
        <label className="flex flex-col gap-[5px] text-sm">
          <span className="text-xs text-fg/70">Month</span>
          <Select name="m" defaultValue={ym} className="w-auto!">
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
        </label>
        <span className="mb-2">
          <Tag label={c.locked ? "Locked" : "Unlocked"}>{c.locked ? "Locked" : c.partly ? "Partly locked" : "Unlocked"}</Tag>
        </span>
      </AutoFilter>
      <div className="grid gap-14 [grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))]">
        <section className="max-w-[560px]">
          <h3 className="mb-3.5 text-[22px]">Summary for {label}</h3>
          {c.rows.map(([k, v, bold]) => (
            <div key={k} className={cx("flex justify-between gap-3 border-b border-line-soft py-[7px] text-[15px]", bold && "font-semibold")}>
              <span>{k}</span>
              <span className={cx("tabular-nums", k === "Net profit" && v < 0 && "text-alert-700")}>{formatRupees(v)}</span>
            </div>
          ))}
          {!opening?.asOf && (
            <p className="mt-3 text-[13px] text-muted">
              Opening and closing balances start from zero because no opening cash and bank balances are set.{" "}
              <Link href="/settings/import" className="text-accent">
                Set them in Settings
              </Link>
              .
            </p>
          )}
        </section>
        <section className="flex max-w-[420px] flex-col gap-3.5">
          <h3 className="text-xl">Month lock</h3>
          <p className="text-sm text-muted">
            {c.locked
              ? "This month is locked. Only the Super Admin can add or change entries dated in it, and every unlock is audited."
              : `Lock the month after review. Staff can no longer add or change invoices, payments or expenses dated in ${label}.`}
          </p>
          <div className="flex flex-wrap gap-2.5">
            {!c.locked && ym < today.slice(0, 7) && u.can("months.lock") && (
              <form action={lock.bind(null, ym)}>
                <ConfirmButton variant="primary" confirm={`Lock ${label}? Only a Super Admin can change it afterwards.`}>
                  <LockSimpleIcon size={16} weight="duotone" />
                  Lock {label}
                </ConfirmButton>
              </form>
            )}
            {(c.locked || c.partly) && u.can("months.unlock") && (
              <form action={unlock.bind(null, ym)}>
                <ConfirmButton confirm={`Unlock ${label}?`}>
                  <LockSimpleOpenIcon size={16} weight="duotone" />
                  Unlock (Super Admin)
                </ConfirmButton>
              </form>
            )}
          </div>
          {ym === today.slice(0, 7) && <p className="text-[13px] text-muted">The current month can be locked once it has ended.</p>}
          <div className="text-[13px] text-muted">Locked months: {lockedMonths.length ? lockedMonths.map(monthLabel).join(", ") : "none"}</div>
        </section>
      </div>
    </>
  );
}
