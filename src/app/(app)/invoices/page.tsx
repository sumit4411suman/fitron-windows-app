import Link from "next/link";
import { FilePlusIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listInvoices } from "@/lib/services/billing";
import { limitSearch, TOO_MANY_SEARCHES } from "@/lib/rate-limit";
import { AutoFilter } from "@/components/auto-filter";
import { InvoiceStatusBadge } from "@/components/invoice-status";
import { LinkButton, ListHeader, Pager, SEARCH, Segmented, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { fmtDate, formatRupees } from "@/lib/format";

export const metadata = { title: "Invoices · Fitron" };

const PAGE = 15;
const FILTERS = [
  ["", "All"],
  ["PAID", "Paid"],
  ["PARTIALLY_PAID", "Part paid"],
  ["UNPAID", "Unpaid"],
  ["OVERDUE", "Overdue"],
  ["CANCELLED", "Cancelled"],
] as const;

/** "Monthly membership (Oct 2026)" → "Monthly membership", as the prototype lists items. */
const itemName = (d: string) => d.split(" (")[0];

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const u = await requirePermission("invoices.view");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const f = { q: s("q"), status: s("status") ?? "" };
  const page = Math.max(1, Number(s("page") ?? 1) || 1);
  const load = () => Promise.all([listInvoices(u, f), db.invoice.count({ where: { orgId: u.orgId, branchId: { in: u.branchIds } } })]);
  const loaded = f.q ? await limitSearch(u.id, load) : await load();
  const limited = loaded === null;
  const [{ rows }, count] = loaded ?? [{ rows: [] }, 0];
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const link = (o: { status?: string; page?: number }) => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    const st = o.status ?? f.status;
    if (st) p.set("status", st);
    if (o.page && o.page > 1) p.set("page", String(o.page));
    return `/invoices${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6 pt-4">
      <ListHeader
        kicker={`${count.toLocaleString("en-IN")} invoices · numbering is sequential and unique`}
        title="Invoices"
        actions={
          u.can("invoices.create") && (
            <LinkButton href="/invoices/new" variant="primary">
              <FilePlusIcon size={17} weight="duotone" />
              Create invoice
            </LinkButton>
          )
        }
      />
      <div className="flex flex-wrap gap-2.5">
        <AutoFilter className="contents">
          {f.status && <input type="hidden" name="status" value={f.status} />}
          <input type="text" name="q" defaultValue={f.q} placeholder="Invoice number or member" aria-label="Search invoices" className={SEARCH} />
        </AutoFilter>
        <Segmented current={f.status} options={FILTERS.map(([k, l]) => ({ key: k, label: l, href: link({ status: k }) }))} />
      </div>
      <ScrollRegion label="Invoices table">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Invoice</th>
              <th className={TH}>Date</th>
              <th className={TH}>Member</th>
              <th className={TH}>Items</th>
              <th className={cx(TH, "text-right")}>Total</th>
              <th className={cx(TH, "text-right")}>Balance</th>
              <th className={TH}>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={cx(TR, "relative cursor-pointer")}>
                <td className={cx(TD, "whitespace-nowrap")}>
                  <Link href={`/invoices/${r.id}`} className="after:absolute after:inset-0">
                    {r.number}
                  </Link>
                </td>
                <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(r.date)}</td>
                <td className={TD}>
                  {r.member?.name ?? "—"}
                  <div className="text-xs text-muted">{r.member?.code}</div>
                </td>
                <td className={cx(TD, "text-[13px]")}>
                  {r.items.map((i) => itemName(i.description)).join(", ")}
                  {r.items.some((i) => i.productId) ? " · POS" : ""}
                </td>
                <td className={cx(TD, "text-right")}>{formatRupees(r.total)}</td>
                <td className={cx(TD, "text-right")}>{r.balance && r.status !== "CANCELLED" ? formatRupees(r.balance) : "—"}</td>
                <td className={TD}>
                  <InvoiceStatusBadge status={r.status} overdueDays={r.overdueDays} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {limited ? (
        <p role="alert" className="text-muted">
          {TOO_MANY_SEARCHES}
        </p>
      ) : (
        rows.length === 0 && <p className="text-muted">{f.q || f.status ? "No invoices match." : "No invoices yet."}</p>
      )}
      <Pager page={page} pageSize={PAGE} total={rows.length} href={(p) => link({ page: p })} />
    </div>
  );
}
