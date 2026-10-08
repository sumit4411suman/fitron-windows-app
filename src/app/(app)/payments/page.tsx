import Link from "next/link";
import { HandCoinsIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listPayments } from "@/lib/services/billing";
import { fromIso, todayIso } from "@/lib/services/time";
import { AutoFilter } from "@/components/auto-filter";
import { Tag } from "@/components/tag";
import { LinkButton, ListHeader, Pager, SEARCH, Select, Stat, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { fmtDate, formatRupees } from "@/lib/format";
import { METHODS } from "@/lib/validation/billing";
import { ReversePayment } from "../invoices/[id]/invoice-forms";

export const metadata = { title: "Payments · Fitron" };

const PAGE = 15;

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const u = await requirePermission("invoices.view");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const f = { q: s("q"), method: s("method") };
  const page = Math.max(1, Number(s("page") ?? 1) || 1);
  const today = todayIso();
  const scope = { orgId: u.orgId, branchId: { in: u.branchIds }, status: "SUCCESS" };
  const [rows, todaySum, month] = await Promise.all([
    listPayments(u, f),
    db.payment.aggregate({ where: { ...scope, date: fromIso(today) }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["method"], where: { ...scope, date: { gte: fromIso(`${today.slice(0, 7)}-01`), lte: fromIso(today) } }, _sum: { amount: true } }),
  ]);
  const byMethod = (pick: (m: string) => boolean) => month.filter((m) => pick(m.method)).reduce((a, m) => a + (m._sum.amount ?? 0), 0);
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.receivedById))] } }, select: { id: true, name: true } });
  const by = new Map(users.map((x) => [x.id, x.name]));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const link = (p: number) => `/payments?${new URLSearchParams({ ...(f.q ? { q: f.q } : {}), ...(f.method ? { method: f.method } : {}), page: String(p) })}`;
  const canReverse = u.can("payments.reverse");

  return (
    <div className="flex flex-col gap-6 pt-4">
      <ListHeader
        kicker="Payment ledger"
        title="Payments"
        actions={
          u.can("payments.collect") && (
            <LinkButton href="/receivables" variant="primary">
              <HandCoinsIcon size={17} weight="duotone" />
              Collect payment
            </LinkButton>
          )
        }
      />
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <Stat label="Today" value={formatRupees(todaySum._sum.amount ?? 0)} />
        <Stat label="This month" value={formatRupees(byMethod(() => true))} />
        <Stat label="Card & other this month" value={formatRupees(byMethod((m) => m !== "UPI" && m !== "Cash"))} />
        <Stat label="UPI this month" value={formatRupees(byMethod((m) => m === "UPI"))} />
        <Stat label="Cash this month" value={formatRupees(byMethod((m) => m === "Cash"))} />
      </div>
      <AutoFilter className="flex flex-wrap gap-2.5">
        <input type="text" name="q" defaultValue={f.q} placeholder="Payment ID, transaction ID, invoice or member" aria-label="Search payments" className={SEARCH} />
        <Select name="method" defaultValue={f.method ?? ""} aria-label="Method" className="w-auto!">
          <option value="">All methods</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </AutoFilter>
      <ScrollRegion label="Payments table">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Payment</th>
              <th className={TH}>Date</th>
              <th className={TH}>Member</th>
              <th className={TH}>Invoice</th>
              <th className={TH}>Method</th>
              <th className={TH}>Transaction ID</th>
              <th className={TH}>Received by</th>
              <th className={TH}>Status</th>
              <th className={cx(TH, "text-right")}>Amount</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className={TR}>
                <td className={cx(TD, "whitespace-nowrap")}>{p.code}</td>
                <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(p.date)}</td>
                <td className={TD}>{p.member.name}</td>
                <td className={cx(TD, "whitespace-nowrap")}>
                  <Link href={`/invoices/${p.invoice.id}`} className="hover:text-accent">
                    {p.invoice.number}
                  </Link>
                </td>
                <td className={TD}>{p.method}</td>
                <td className={cx(TD, "text-[13px]")}>{p.txnRef || "—"}</td>
                <td className={TD}>{by.get(p.receivedById) ?? "—"}</td>
                <td className={TD}>
                  <Tag label={p.status === "SUCCESS" ? "Success" : "Failed"}>{p.status === "SUCCESS" ? "Success" : "Reversed"}</Tag>
                </td>
                <td className={cx(TD, "text-right whitespace-nowrap")}>{formatRupees(p.amount)}</td>
                <td className={TD}>{canReverse && p.status === "SUCCESS" && <ReversePayment paymentId={p.id} invoiceId={p.invoice.id} compact />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {rows.length === 0 && <p className="text-muted">{f.q || f.method ? "No payments match." : "No payments yet."}</p>}
      <Pager page={page} pageSize={PAGE} total={rows.length} href={link} />
    </div>
  );
}
