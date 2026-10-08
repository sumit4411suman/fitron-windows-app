import Link from "next/link";
import { WhatsappLogoIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { listReceivables } from "@/lib/services/billing";
import { todayIso, toIso } from "@/lib/services/time";
import { Tag } from "@/components/tag";
import { ListHeader, Notice, Segmented, Stat, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { fmtDate, formatRupees } from "@/lib/format";
import { remindAllOverdueAction, remindDueAction } from "../reminder-actions";

export const metadata = { title: "Outstanding payments · Fitron" };

const STATUS_TAG = { UNPAID: "UNPAID", PARTIALLY_PAID: "PARTIALLY PAID", PAID: "PAID", CANCELLED: "CANCELLED" } as const;

export default async function ReceivablesPage({ searchParams }: PageProps<"/receivables">) {
  const u = await requirePermission("invoices.view");
  const sp = await searchParams;
  const raw = typeof sp.f === "string" ? sp.f : typeof sp.filter === "string" ? sp.filter : "";
  const f = ["due_today", "overdue", "partial", "unpaid"].includes(raw) ? raw : "";
  const msg = typeof sp.msg === "string" ? sp.msg : null;
  const [{ list, counts, total }, all] = await Promise.all([listReceivables(u, f), f ? listReceivables(u) : null]);
  const open = all?.list ?? list;
  const today = todayIso();
  const rows = [...list].sort((a, b) => b.overdueDays - a.overdueDays);
  const here = `/receivables${f ? `?f=${f}` : ""}`;
  const canWa = u.can("whatsapp.send");

  return (
    <div className="flex flex-col gap-6 pt-4">
      <ListHeader kicker="Accounts receivable" title="Outstanding payments" />
      {msg && <Notice tone="ok">{msg}</Notice>}
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <Stat label="Outstanding" value={formatRupees(total)} tone="alert" />
        <Stat label="Overdue" value={formatRupees(counts.overdue!.amount)} />
        <Stat label="Due today" value={counts.due_today!.n.toLocaleString("en-IN")} />
        <Stat label="Partially paid" value={counts.partial!.n.toLocaleString("en-IN")} />
      </div>
      {canWa && (
        <form action={remindAllOverdueAction.bind(null, here)} className="self-start">
          <button className="inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md bg-accent px-[18px] text-sm font-semibold text-accent-ink hover:bg-accent-hover">
            <WhatsappLogoIcon weight="duotone" />
            Remind all overdue
          </button>
        </form>
      )}
      <Segmented
        current={f}
        options={[
          { key: "", label: `All (${open.length})`, href: "/receivables" },
          { key: "due_today", label: "Due today", href: "/receivables?f=due_today" },
          { key: "overdue", label: "Overdue", href: "/receivables?f=overdue" },
          { key: "partial", label: "Partially paid", href: "/receivables?f=partial" },
          { key: "unpaid", label: "Unpaid", href: "/receivables?f=unpaid" },
        ]}
      />
      <ScrollRegion label="Receivables table">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Member</th>
              <th className={TH}>Invoice</th>
              <th className={cx(TH, "text-right")}>Total</th>
              <th className={cx(TH, "text-right")}>Paid</th>
              <th className={cx(TH, "text-right")}>Pending</th>
              <th className={TH}>Due date</th>
              <th className={TH}>Days overdue</th>
              <th className={TH}>Status</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={TR}>
                <td className={TD}>
                  <Link href={u.can("members.view") ? `/members/${r.member.id}` : `/invoices/${r.id}`} className="hover:text-accent">
                    {r.member.name}
                    <span className="block text-xs text-muted">{r.member.phone}</span>
                  </Link>
                </td>
                <td className={cx(TD, "whitespace-nowrap")}>
                  <Link href={`/invoices/${r.id}`} className="hover:text-accent">
                    {r.number}
                  </Link>
                </td>
                <td className={cx(TD, "text-right")}>{formatRupees(r.total)}</td>
                <td className={cx(TD, "text-right")}>{formatRupees(r.paid)}</td>
                <td className={cx(TD, "text-right font-semibold")}>{formatRupees(r.balance)}</td>
                <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(r.dueDate)}</td>
                <td className={TD}>{r.overdueDays ? `${r.overdueDays} days` : "—"}</td>
                <td className={TD}>
                  <Tag label={r.overdueDays > 0 ? "OVERDUE" : toIso(r.dueDate) === today ? "DUE TODAY" : STATUS_TAG[r.status]} />
                </td>
                <td className={cx(TD, "text-right whitespace-nowrap")}>
                  <span className="inline-flex items-center gap-1">
                    {canWa && (
                      <form action={remindDueAction.bind(null, r.member.id, r.number, here)}>
                        <button title="Send WhatsApp reminder" aria-label="Send WhatsApp reminder" className="grid size-9 place-items-center rounded-md hover:bg-fg/7">
                          <WhatsappLogoIcon size={18} weight="duotone" />
                        </button>
                      </form>
                    )}
                    {u.can("payments.collect") && (
                      <Link href={`/invoices/${r.id}#collect`} className="inline-flex py-2.5 leading-[1.2] items-center rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">
                        Collect
                      </Link>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {rows.length === 0 && <p className="text-muted">Nothing outstanding in this view.</p>}
    </div>
  );
}
