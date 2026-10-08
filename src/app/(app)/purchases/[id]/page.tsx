import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getPurchase } from "@/lib/services/purchases";
import { XIcon } from "@phosphor-icons/react/dist/ssr";
import { Badge, LinkButton, ListHeader, TABLE, TD, TH, ScrollRegion } from "@/components/ui";
import { ACCOUNTING_TABS, SectionTabs } from "@/components/section-tabs";
import { fmtDate, fmtStamp, formatInr } from "@/lib/format";
import { todayIso, toIso } from "@/lib/services/time";
import { CancelPurchase, PayVendorForm } from "../purchase-forms";

export const metadata = { title: "Purchase · Fitron" };

const TYPE = { STOCK: "Stock", ASSET: "Asset", EXPENSE: "Expense" } as const;

export default async function PurchasePage({ params }: PageProps<"/purchases/[id]">) {
  const u = await requirePermission("purchases.manage");
  const { id } = await params;
  const p = await getPurchase(u, id);
  if (!p) notFound();
  const active = p.status === "ACTIVE";
  const link = (l: (typeof p.lines)[number]) => {
    if (l.productId) {
      const x = p.products.find((y) => y.id === l.productId);
      return x ? <Link href={`/products/${x.id}`} className="text-accent">{x.sku}</Link> : null;
    }
    if (l.assetId) {
      const x = p.assets.find((y) => y.id === l.assetId);
      return x ? <Link href={`/assets/${x.id}`} className="text-accent">{x.code}</Link> : <span className="text-muted">removed</span>;
    }
    if (l.type === "EXPENSE") return <span>{p.categories.find((y) => y.id === l.category)?.name ?? l.category}</span>;
    return null;
  };
  const branchLabel = u.branch === "ALL" ? "All branches (consolidated)" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");
  const h3 = "m-0 text-xl";
  return (
    <div className="flex flex-col gap-7">
      <ListHeader kicker={branchLabel} title="Accounting" />
      <SectionTabs u={u} className="mb-0" tabs={ACCOUNTING_TABS} current="/purchases" />
      <section className="grid gap-x-14 gap-y-8 pt-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="m-0 text-[22px]">
                {p.code} · {p.vendor}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                {!active ? <Badge>Cancelled</Badge> : p.balance > 0 ? <Badge tone="alert">{formatInr(p.balance)} due</Badge> : <Badge tone="ok">Paid</Badge>}
                <span>
                  {fmtDate(p.date)}
                  {p.billNo ? ` · Bill ${p.billNo}` : ""} · {formatInr(p.total)} incl. GST
                  {u.branchIds.length > 1 ? ` · ${p.branch.name}` : ""}
                </span>
              </div>
            </div>
            <LinkButton variant="ghost" href="/purchases" aria-label="Close" className="px-2!">
              <XIcon size={18} weight="duotone" />
            </LinkButton>
          </div>
          {!active && <p className="text-sm text-alert">Cancelled: {p.cancelReason}</p>}
          <ScrollRegion label="Purchase lines">
            <table className={`${TABLE} min-w-[460px]`}>
              <thead>
                <tr>
                  <th className={TH}>Type</th>
                  <th className={TH}>Item</th>
                  <th className={TH}>Ref</th>
                  <th className={`${TH} text-right`}>Rate</th>
                  <th className={`${TH} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {p.lines.map((l) => (
                  <tr key={l.id}>
                    <td className={TD}>{TYPE[l.type as keyof typeof TYPE]}</td>
                    <td className={TD}>
                      {l.description}
                      {l.qty > 1 ? ` ×${l.qty}` : ""}
                    </td>
                    <td className={`${TD} text-xs text-muted`}>{link(l)}</td>
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      {formatInr(l.rate)}
                      {Number(l.gstPct) > 0 ? ` + ${Number(l.gstPct)}% GST` : ""}
                    </td>
                    <td className={`${TD} text-right whitespace-nowrap`}>{formatInr(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <div className="flex max-w-[560px] justify-between text-base font-semibold">
            <span>Bill total</span>
            <span className="tabular-nums">{formatInr(p.total)}</span>
          </div>
          {p.notes && <div className="text-sm text-muted">{p.notes}</div>}
        </div>
        <div className="flex min-w-0 flex-col gap-2.5">
          <h3 className={h3}>Payments</h3>
          {p.payments.length === 0 ? (
            <div className="text-sm text-muted">Nothing paid yet.</div>
          ) : (
            p.payments.map((x) => (
              <div key={x.id} className="flex justify-between gap-2 text-[15px]">
                <span>
                  {fmtDate(x.date)} · {x.method} · {formatInr(x.amount)}
                  <span className="block text-xs text-muted">
                    {x.code}
                    {x.reference ? ` · ${x.reference}` : ""}
                  </span>
                </span>
              </div>
            ))
          )}
          <div className="text-[15px] font-semibold">Balance: {formatInr(p.balance)}</div>
          {active && p.balance > 0 && (
            <div id="pay" className="mt-5 flex flex-col gap-2.5">
              <h3 className={h3}>Pay the supplier</h3>
              <PayVendorForm id={p.id} balance={p.balance} today={todayIso()} billDate={toIso(p.date)} />
            </div>
          )}
          <div className="mt-5 flex flex-col gap-2.5">
            <h3 className={h3}>Posted to</h3>
            <ul className="divide-y divide-line text-sm">
              {p.expenses.map((x) => (
                <li key={x.id} className="flex justify-between gap-2 py-1.5">
                  <span>
                    {x.code} {x.capital ? <Badge>Capital</Badge> : null} {x.status === "VOID" ? <Badge>Void</Badge> : null}
                  </span>
                  <span className="text-muted">{x.method}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Recorded {fmtStamp(p.createdAt)}.</p>
          </div>
          {active && (
            <div className="mt-5 flex flex-col gap-2.5">
              <h3 className={h3}>Wrong bill or goods returned?</h3>
              <CancelPurchase id={p.id} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
