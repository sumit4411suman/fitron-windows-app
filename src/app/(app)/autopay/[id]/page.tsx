import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getMandate } from "@/lib/services/autopay";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDate, fmtStamp, fmtTime, formatInr } from "@/lib/format";
import { MandateButton } from "../autopay-forms";
import { retryAction } from "../actions";
import { MANDATE_TONE } from "../tone";

export const metadata = { title: "Autopay mandate · Fitron" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value || "—"}</dd>
    </div>
  );
}

export default async function MandatePage({ params }: PageProps<"/autopay/[id]">) {
  const u = await requirePermission("autopay.manage");
  const { id } = await params;
  const m = await getMandate(u, id);
  if (!m) notFound();
  const [plan, charges] = await Promise.all([
    db.membershipPlan.findUnique({ where: { id: m.planId }, select: { name: true } }),
    db.membership.findMany({ where: { memberId: m.memberId, type: "AUTOPAY" }, orderBy: { startDate: "desc" }, include: { invoice: { select: { id: true, number: true, total: true } } } }),
  ]);
  return (
    <>
      <PageHeader
        title={`${m.code} · ${m.member.name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={MANDATE_TONE[m.status as keyof typeof MANDATE_TONE] ?? "neutral"}>{m.status}</Badge>
            {m.mode === "demo" ? "Demo mandate" : "Live (Razorpay)"} · {plan?.name} · {formatInr(m.amount)} every {m.months} month{m.months > 1 ? "s" : ""}
          </span>
        }
        actions={
          <>
            {m.status === "Pending" && m.mode === "demo" && <MandateButton id={m.id} action="approve-demo" label="Approve (demo)" variant="primary" />}
            {["Failed", "Halted"].includes(m.status) && (
              <form action={retryAction.bind(null, m.id, "")}>
                <button className="inline-flex min-h-10 items-center rounded-md border border-line px-4 text-sm font-semibold hover:bg-fg/7">Retry now</button>
              </form>
            )}
            {m.status === "Active" && <MandateButton id={m.id} action="pause" label="Pause" />}
            {["Paused", "Halted", "Failed"].includes(m.status) && <MandateButton id={m.id} action="resume" label="Resume" variant="primary" />}
            {m.status !== "Cancelled" && <MandateButton id={m.id} action="cancel" label="Cancel autopay" variant="danger" confirm="Cancel this autopay? The member will have to approve a new one to restart." />}
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Mandate">
          <dl className="divide-y divide-line text-sm">
            <Row label="Member" value={u.can("members.view") ? <Link href={`/members/${m.member.id}`} className="text-accent">{m.member.name} ({m.member.code})</Link> : `${m.member.name} (${m.member.code})`} />
            <Row label="Next debit" value={m.nextDebitOn && ["Active", "Pending"].includes(m.status) ? fmtDate(m.nextDebitOn) : null} />
            <Row label="Next retry" value={m.nextRetryOn && m.status === "Failed" ? fmtDate(m.nextRetryOn) : null} />
            <Row label="Last result" value={m.lastResult} />
            <Row label="Failed attempts" value={String(m.retries)} />
            <Row label="Approval link" value={m.shortUrl ? <a href={m.shortUrl} target="_blank" rel="noreferrer" className="text-accent">{m.shortUrl}</a> : m.mode === "demo" ? "Demo: no real link" : null} />
            <Row label="Razorpay subscription" value={m.subscriptionId} />
            <Row label="Set up" value={fmtStamp(m.createdAt)} />
          </dl>
        </Card>
        <Card title="Renewals by autopay">
          {charges.length === 0 ? (
            <p className="text-sm text-muted">No debits yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {charges.map((c) => (
                <li key={c.id}>
                  <Link href={`/invoices/${c.invoice.id}`} className="flex justify-between gap-2 py-2 hover:text-accent">
                    <span>
                      {fmtDate(c.startDate)} to {fmtDate(c.endDate)}
                    </span>
                    <span>
                      {c.invoice.number} · {formatInr(c.invoice.total)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {m.events.length > 0 && (
          <Card title="Razorpay events" className="md:col-span-2">
            <ul className="divide-y divide-line text-sm">
              {m.events.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 py-2">
                  <span>{e.type}</span>
                  <span className="text-muted">
                    {e.result} · {fmtStamp(e.createdAt)} {fmtTime(e.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
