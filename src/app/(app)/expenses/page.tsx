import Link from "next/link";
import { DownloadSimpleIcon, PaperclipIcon, PlusIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { expenseTrend, listCategories, listExpenses } from "@/lib/services/expenses";
import { todayIso } from "@/lib/services/time";
import { monthEnd, monthLabel, monthsBack } from "@/lib/domain/periods";
import { AutoFilter } from "@/components/auto-filter";
import { Dialog } from "@/components/dialog";
import { LinkButton, ListHeader, Select, TABLE, TD, TH, cx, ScrollRegion } from "@/components/ui";
import { fmtDate, fmtMonthShort, formatRupees } from "@/lib/format";
import { ExpenseForm, VoidExpense } from "./expense-form";

export const metadata = { title: "Expenses · Fitron" };

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const u = await requirePermission("expenses.manage");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const today = todayIso();
  const months = monthsBack(today, 12);
  // The prototype's two filters: a month (or all months) and a category. Default is this month.
  const month = s("month") === "All" ? "All" : months.includes(s("month") ?? "") ? s("month")! : today.slice(0, 7);
  const cats = await listCategories();
  const cat = cats.find((c) => c.id === s("cat"));
  const range = month === "All" ? {} : { from: `${month}-01`, to: monthEnd(month) };
  const [rows, trend] = await Promise.all([listExpenses(u, { ...range, categoryId: cat?.id, includeVoid: s("void") === "1" }), expenseTrend(u, months, cat?.id)]);
  const live = rows.filter((r) => r.status === "ACTIVE");
  const total = live.reduce((a, r) => a + r.amount, 0);
  const byCat = [...live.reduce((m, r) => m.set(r.category.name, (m.get(r.category.name) ?? 0) + r.amount), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...byCat.map((x) => x[1]));
  const maxMonth = Math.max(1, ...trend.map((x) => x.amount));
  const q = new URLSearchParams({ ...(month !== today.slice(0, 7) && { month }), ...(cat && { cat: cat.id }), ...(s("void") === "1" && { void: "1" }) }).toString();
  const here = q ? `/expenses?${q}` : "/expenses";
  const csv = `/expenses/csv?${new URLSearchParams({ month, ...(cat && { cat: cat.id }) })}`;

  return (
    <div className="flex flex-col gap-7">
      <ListHeader
        kicker={month === "All" ? "All months" : monthLabel(month)}
        title="Expenses"
        actions={
          <>
            <LinkButton href={`${here}${q ? "&" : "?"}do=add`} variant="primary" scroll={false}>
              <PlusIcon size={17} weight="duotone" />
              Add expense
            </LinkButton>
            {u.can("purchases.manage") && (
              <LinkButton href="/purchases/new">
                <ReceiptIcon size={16} weight="duotone" />
                Purchase bill
              </LinkButton>
            )}
            <a href={csv} className="inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">
              <DownloadSimpleIcon size={16} weight="duotone" />
              Export CSV
            </a>
          </>
        }
      />

      <AutoFilter className="flex flex-wrap items-center gap-2.5">
        <Select name="month" defaultValue={month} aria-label="Month" className="w-auto!">
          <option value="All">All months</option>
          {[...months].reverse().map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </Select>
        <Select name="cat" defaultValue={cat?.id ?? ""} aria-label="Category" className="w-auto!">
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {u.can("expenses.void") && (
          <label className="flex items-center gap-2 px-1 text-sm text-muted">
            <input type="checkbox" name="void" value="1" defaultChecked={s("void") === "1"} className="size-4 accent-[var(--accent)]" /> Show voided
          </label>
        )}
      </AutoFilter>

      <div className="grid gap-10 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <section>
          <div className="text-[11px] tracking-[0.08em] text-muted uppercase">Total</div>
          <div className="mb-[18px] text-[34px] font-semibold">{formatRupees(total)}</div>
          <div className="flex flex-col gap-2.5">
            {byCat.map(([label, v]) => (
              <div key={label} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
                <span>{label}</span>
                <span className="h-2.5 bg-neutral-200">
                  <span className="block h-full bg-fg/60" style={{ width: `${Math.round((v / maxCat) * 100)}%` }} />
                </span>
                <span className="whitespace-nowrap">{formatRupees(v)}</span>
              </div>
            ))}
            {!byCat.length && <p className="text-sm text-muted">No expenses in this period.</p>}
          </div>
        </section>
        <section>
          <h3 className="mb-3.5 text-xl">Monthly expense trend</h3>
          <div className="flex h-[180px] items-end gap-1.5">
            {trend.map((m) => (
              <div key={m.month} title={`${monthLabel(m.month)}: ${formatRupees(m.amount)}`} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5">
                <div className={"bg-fg/45"} style={{ height: `${Math.round((m.amount / maxMonth) * 100)}%` }} />
                <div className="truncate text-center text-[10px] text-muted">{fmtMonthShort(m.month)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <ScrollRegion label="Expenses table">
        <table className={TABLE}>
          <thead>
            <tr>
              {["Expense", "Date", "Category", "Description", "Vendor", "Method", "Bill no.", "Bill", "Amount", ""].map((h, i) => (
                <th key={i} className={cx(TH, h === "Amount" && "text-right")}>
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cx("hover:bg-fg/4", r.status === "VOID" && "text-muted line-through")}>
                <td className={cx(TD, "whitespace-nowrap")}>{r.code}</td>
                <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(r.date)}</td>
                <td className={TD}>
                  {r.category.name}
                  {r.capital ? " · capitalised" : ""}
                </td>
                <td className={TD}>
                  {r.description}
                  {r.purchaseId && (
                    <Link href={`/purchases/${r.purchaseId}`} className="ml-1.5 text-xs text-accent no-underline">
                      bill
                    </Link>
                  )}
                  {r.assetId && (
                    <Link href={`/assets/${r.assetId}`} className="ml-1.5 text-xs text-accent no-underline">
                      asset
                    </Link>
                  )}
                  {r.status === "VOID" && <span className="block text-xs no-underline">Voided: {r.voidReason}</span>}
                </td>
                <td className={TD}>{r.vendor ?? "—"}</td>
                <td className={TD}>{r.method}</td>
                <td className={cx(TD, "text-[13px]")}>{r.billNo ?? "—"}</td>
                <td className={TD}>{r.attachmentKey && <PaperclipIcon size={16} weight="duotone" className="text-accent" aria-label="Bill attached" />}</td>
                <td className={cx(TD, "text-right whitespace-nowrap")}>{formatRupees(r.amount)}</td>
                <td className={cx(TD, "text-right")}>{r.status === "ACTIVE" && !r.purchaseId && !r.assetId && u.can("expenses.void") && <VoidExpense id={r.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="mt-3 text-sm text-muted">No expenses match these filters.</p>}
      </ScrollRegion>

      {s("do") === "add" && (
        <Dialog kicker="Accounts" title="Add expense" close={here} width={640} form>
          <ExpenseForm categories={cats} today={today} close={here} />
        </Dialog>
      )}
    </div>
  );
}
