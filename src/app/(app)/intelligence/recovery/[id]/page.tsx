import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { RECOVERY_STATUS_LABEL, type RecoveryStatus } from "@/lib/domain/recovery";
import { getCase } from "@/lib/services/recovery";
import { UserError } from "@/lib/services/errors";
import { todayIso, toIso } from "@/lib/services/time";
import { fmtDate, fmtStamp, formatRupees } from "@/lib/format";
import { Tag } from "@/components/tag";
import { Badge, Card, LinkButton, Notice, ScrollRegion, Stat, TABLE, TD, TH, TR, cx } from "@/components/ui";
import { IntelligenceShell } from "../../_ui";
import { CaseActions } from "./case-actions";

export const metadata = { title: "Recovery case · Fitron" };

const OUTCOME: Record<string, string> = { SENT: "Sent", QUEUED: "Queued on WhatsApp", LOGGED: "Saved, not sent (demo mode)", FAILED: "Failed", SKIPPED: "Not sent: reminded recently", NO_ANSWER: "No answer", PROMISED: "Promised to pay", REFUSED: "Refused", PAID: "Paid", NOTED: "Noted" };
const KIND: Record<string, string> = { WHATSAPP: "WhatsApp reminder", CALL: "Call", VISIT: "Visit", NOTE: "Note", PAYMENT: "Payment recorded", CLOSE: "Closed" };

export default async function CasePage({ params }: PageProps<"/intelligence/recovery/[id]">) {
  const u = await requirePermission("accounting.view");
  const { id } = await params;
  let c: Awaited<ReturnType<typeof getCase>>;
  try {
    c = await getCase(u, id);
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }
  const today = todayIso();
  const open = c.status === "OPEN" || c.status === "IN_PROGRESS";
  const memberHref = u.can("members.view") ? `/members/${c.member.id}` : null;

  return (
    <IntelligenceShell
      u={u}
      current="/intelligence/recovery"
      title={c.member.name}
      subtitle={
        <>
          {c.kind === "DUES" ? "Outstanding dues" : "Renewal opportunity"} · {c.member.code} · {c.member.phone} ·{" "}
          <Link href="/intelligence/recovery" className="underline">
            back to the queue
          </Link>
        </>
      }
      actions={
        <>
          {memberHref && (
            <LinkButton href={memberHref} variant="default">
              Member profile
            </LinkButton>
          )}
          {c.kind === "DUES" && c.invoice && (
            <LinkButton href={`/invoices/${c.invoice.id}`} variant="default">
              Invoice {c.invoice.number}
            </LinkButton>
          )}
          {c.kind === "RENEWAL" && memberHref && u.can("memberships.renew") && (
            <LinkButton href={`/members/${c.member.id}/sell`} variant="primary">
              Sell the renewal
            </LinkButton>
          )}
        </>
      }
    >
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        {c.kind === "DUES" ? (
          <>
            <Stat label="Balance now" value={formatRupees(c.balance)} tone={c.balance > 0 ? "alert" : undefined} />
            <Stat label="When the case opened" value={formatRupees(c.openingAmount)} />
            <Stat label="Recovered since" value={formatRupees(c.recoveredAmount)} />
            <Stat label="Overdue" value={c.overdueDays ? `${c.overdueDays} days` : "—"} />
          </>
        ) : (
          <>
            <Stat label="Last plan's net price" value={formatRupees(c.openingAmount)} />
            <Stat label="Plan ended" value={c.membership ? fmtDate(toIso(c.membership.endDate)) : "—"} />
            <Stat label="Plan" value={c.membership?.plan.name ?? "—"} />
          </>
        )}
        <Stat label="Priority" value={String(c.priority)} />
        <div>
          <div className="text-[11px] tracking-[0.08em] text-muted uppercase">Status</div>
          <div className="mt-1.5">
            <Tag label={RECOVERY_STATUS_LABEL[c.status as RecoveryStatus] ?? c.status} style={c.status === "RECOVERED" || c.status === "RENEWED" ? 0 : c.status === "CLOSED" ? "neutral" : c.status === "IN_PROGRESS" ? 1 : 4} />
          </div>
        </div>
      </div>
      {c.kind === "RENEWAL" && <Notice tone="neutral">A renewal opportunity is the value of the plan that ended, not money owed. It closes by itself when the member buys again.</Notice>}
      {open && (
        <Notice tone="accent">
          <strong>Recommended next step:</strong> {c.nextAction}
          {c.nextActionOn && <> · {toIso(c.nextActionOn) <= today ? "due now" : `from ${fmtDate(toIso(c.nextActionOn))}`}</>}
          {c.promisedOn && <> · promised {c.promisedAmount ? formatRupees(c.promisedAmount) : "to pay"} by {fmtDate(toIso(c.promisedOn))}</>}
        </Notice>
      )}
      {c.closeReason && <Notice tone="neutral">Closed: {c.closeReason}</Notice>}

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card title="Follow-ups">
          {c.attemptsLog.length === 0 ? (
            <p className="text-sm text-muted">No follow-up recorded yet.</p>
          ) : (
            <ScrollRegion label="Follow-ups">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>When</th>
                    <th className={TH}>What</th>
                    <th className={TH}>Outcome</th>
                    <th className={TH}>By</th>
                  </tr>
                </thead>
                <tbody>
                  {c.attemptsLog.map((a) => (
                    <tr key={a.id} className={TR}>
                      <td className={cx(TD, "whitespace-nowrap")}>{fmtStamp(a.at)}</td>
                      <td className={TD}>
                        {KIND[a.kind] ?? a.kind}
                        {a.note && <span className="block text-xs text-muted">{a.note}</span>}
                      </td>
                      <td className={TD}>
                        <Badge tone={a.outcome === "PAID" || a.outcome === "SENT" ? "ok" : a.outcome === "FAILED" || a.outcome === "REFUSED" ? "alert" : "neutral"}>{OUTCOME[a.outcome] ?? a.outcome}</Badge>
                        {a.promisedOn && <span className="block text-xs text-muted">{a.promisedAmount ? formatRupees(a.promisedAmount) : "Pay"} by {fmtDate(toIso(a.promisedOn))}</span>}
                        {a.promisedAmount && a.kind === "PAYMENT" && <span className="block text-xs text-muted">{formatRupees(a.promisedAmount)}</span>}
                      </td>
                      <td className={TD}>{a.byId ? (c.byName.get(a.byId) ?? "Staff") : "Automatic"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </Card>
        <Card title={c.kind === "DUES" ? "Invoice and payments" : "Membership"}>
          {c.kind === "DUES" && c.invoice ? (
            <>
              <p className="m-0 text-sm">
                {c.invoice.number} · {formatRupees(c.invoice.total)} · issued {fmtDate(toIso(c.invoice.date))}, due {fmtDate(toIso(c.invoice.dueDate))}
                {c.invoice.status === "CANCELLED" && <Badge tone="alert">Cancelled</Badge>}
              </p>
              <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-sm">
                {c.invoice.payments.map((p) => (
                  <li key={p.id} className={cx(p.status === "REVERSED" && "text-muted line-through")}>
                    {fmtDate(toIso(p.date))} · {p.code} · {formatRupees(p.amount)} by {p.method}
                  </li>
                ))}
                {c.invoice.payments.length === 0 && <li className="text-muted">No payment yet.</li>}
              </ul>
            </>
          ) : c.membership ? (
            <p className="m-0 text-sm">
              {c.membership.plan.name} · {fmtDate(toIso(c.membership.startDate))} to {fmtDate(toIso(c.membership.endDate))} · {formatRupees(c.membership.price - c.membership.discount)} net
            </p>
          ) : (
            <p className="text-sm text-muted">—</p>
          )}
        </Card>
      </div>

      <CaseActions id={c.id} kind={c.kind} open={open} closed={c.status === "CLOSED"} balance={c.balance} today={today} canWhatsApp={u.can("whatsapp.send")} canCollect={u.can("payments.collect")} />
    </IntelligenceShell>
  );
}
