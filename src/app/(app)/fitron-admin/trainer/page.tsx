import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { isFitronAdmin } from "@/lib/integrations/fitron-team";
import { partnerPayouts, trainerMembers, trainerOverview, trainerPaymentList, type TrainerListFilter } from "@/lib/services/trainer-admin";
import { todayIso } from "@/lib/services/time";
import { findPlan } from "@/lib/domain/pricing";
import { Badge, Card, Empty, Input, LinkButton, PageHeader, Pager, Select, Stat, TABLE, TD, TH, TR, type Tone, ScrollRegion } from "@/components/ui";
import { fmtMonthShort, fmtShort, fmtStamp, formatRupees } from "@/lib/format";
import { AdminTabs } from "../tabs";

export const metadata = { title: "AI Trainer · FITRON" };

const ACCESS: Record<string, [string, Tone]> = { ACTIVE: ["Paid", "ok"], TRIAL: ["Trial", "accent"], LOCKED: ["No plan", "neutral"] };
const PAY: Record<string, [string, Tone]> = { PENDING: ["Started", "neutral"], PAID: ["Paid", "ok"] };
const STATUSES: [TrainerListFilter["status"], string][] = [["", "Everyone"], ["active", "Paying"], ["trial", "On trial"], ["locked", "No plan"], ["linked", "Linked to a gym"], ["new", "Joined in 30 days"]];
const PAGE = 50;

/** FITRON team only (FITRON_ADMIN_EMAILS): the whole AI Trainer at a glance, every member and payment, and what each gym is owed. */
export default async function TrainerAdminPage({ searchParams }: PageProps<"/fitron-admin/trainer">) {
  const u = await requireUser();
  if (!isFitronAdmin(u.email)) notFound();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab = ["payments", "payouts"].includes(str("tab")) ? str("tab") : "members";
  const page = Math.max(1, Number(str("page")) || 1);
  const today = todayIso();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(str("month")) ? str("month") : today.slice(0, 7);
  const q = str("q").slice(0, 100);
  const status = (STATUSES.some(([k]) => k === str("status")) ? str("status") : "") as TrainerListFilter["status"];
  const payStatus = str("status");

  const o = await trainerOverview(today);
  const members = tab === "members" ? await trainerMembers({ q, status, page, pageSize: PAGE }, today) : null;
  const payments = tab === "payments" ? await trainerPaymentList({ status: payStatus, page, pageSize: PAGE }) : null;
  const payouts = tab === "payouts" ? await partnerPayouts(month) : null;
  const qs = (p: number) => new URLSearchParams({ ...(tab !== "members" ? { tab } : {}), ...(q ? { q } : {}), ...(status || payStatus ? { status: status || payStatus } : {}), ...(tab === "payouts" ? { month } : {}), page: String(p) }).toString();
  const months = [0, 1, 2, 3, 4, 5].map((n) => {
    const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - n, 1));
    return d.toISOString().slice(0, 7);
  });

  return (
    <>
      <PageHeader title="FITRON AI Trainer" subtitle="Every member of the AI Trainer, what they pay FITRON, and what FITRON owes partner gyms." />
      <AdminTabs current={tab === "members" ? "/fitron-admin/trainer" : `/fitron-admin/trainer?tab=${tab}`} />

      <div className="mb-8 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-5">
        <Stat label="Members" value={o.total} />
        <Stat label="Paying" value={o.active} />
        <Stat label="On trial" value={o.trial} />
        <Stat label="No plan" value={o.locked} />
        <Stat label="Linked to a gym" value={o.linked} />
        <Stat label="Joined this month" value={o.newThisMonth} />
        <Stat label="Seen in 7 days" value={o.seenWeek} />
        <Stat label="Coach messages today" value={o.coachToday} />
        <Stat label={`Paid · ${fmtMonthShort(o.month)}`} value={formatRupees(o.thisMonth.total)} />
        <Stat label="Paid · last month" value={formatRupees(o.lastMonth.total)} />
      </div>

      {members && (
        <Card
          title={`Members · ${members.total}`}
          action={
            <LinkButton href={`/fitron-admin/trainer/csv?what=members${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${status}` : ""}`} variant="ghost">
              Download CSV
            </LinkButton>
          }
        >
          <form className="mb-4 flex flex-wrap gap-2" action="/fitron-admin/trainer">
            <Input name="q" defaultValue={q} placeholder="Name, email or gym" className="max-w-[300px] flex-1" />
            <Select name="status" defaultValue={status}>
              {STATUSES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <button className="inline-flex py-2.5 leading-[1.2] items-center rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">Search</button>
          </form>
          {members.rows.length === 0 ? (
            <Empty>No members match.</Empty>
          ) : (
            <ScrollRegion label="Members on the AI Trainer">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Member</th>
                    <th className={TH}>Plan</th>
                    <th className={TH}>Gym</th>
                    <th className={TH}>Joined</th>
                    <th className={TH}>Last seen</th>
                    <th className={`${TH} text-right`}>Paid in all</th>
                  </tr>
                </thead>
                <tbody>
                  {members.rows.map((m) => {
                    const [label, tone] = ACCESS[m.access] ?? [m.access, "neutral" as Tone];
                    return (
                      <tr key={m.id} className={TR}>
                        <td className={TD}>
                          <div className="font-medium">{m.name || "—"}</div>
                          <div className="text-xs text-muted">
                            {m.email} · {m.signupVia === "GOOGLE" ? "Google" : "email"}
                            {!m.onboarded && " · not onboarded"}
                          </div>
                        </td>
                        <td className={TD}>
                          <Badge tone={tone}>{label}</Badge>{" "}
                          <span className="text-xs text-muted">
                            {findPlan(m.plan)?.name ?? m.plan} · {m.cycle === "YEARLY" ? "yearly" : "monthly"}
                            {m.access === "ACTIVE" && m.paidUntil ? ` · till ${fmtShort(m.paidUntil)}${m.planCancelled ? " (not renewing)" : ""}` : ""}
                            {m.access === "TRIAL" && m.trialEndsAt ? ` · trial till ${fmtShort(m.trialEndsAt)}` : ""}
                          </span>
                        </td>
                        <td className={TD}>{m.gym ? `${m.gym}${m.gymCode ? ` · ${m.gymCode}` : ""}` : <span className="text-muted">—</span>}</td>
                        <td className={TD}>{fmtStamp(m.createdAt)}</td>
                        <td className={TD}>{m.lastSeenAt ? fmtStamp(m.lastSeenAt) : "—"}</td>
                        <td className={`${TD} text-right tabular-nums`}>{formatRupees(m.lifetime)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          <Pager page={members.page} pageSize={PAGE} total={members.total} href={(p) => `/fitron-admin/trainer?${qs(p)}`} />
        </Card>
      )}

      {payments && (
        <Card
          title={`Payments · ${payments.total}`}
          action={
            <LinkButton href={`/fitron-admin/trainer/csv?what=payments${payStatus ? `&status=${payStatus}` : ""}`} variant="ghost">
              Download CSV
            </LinkButton>
          }
        >
          <form className="mb-4 flex flex-wrap gap-2" action="/fitron-admin/trainer">
            <input type="hidden" name="tab" value="payments" />
            <Select name="status" defaultValue={payStatus}>
              <option value="">Every status</option>
              {Object.entries(PAY).map(([k, [l]]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <button className="inline-flex py-2.5 leading-[1.2] items-center rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">Filter</button>
          </form>
          {payments.rows.length === 0 ? (
            <Empty>No payments yet.</Empty>
          ) : (
            <ScrollRegion label="Trainer payments">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Started</th>
                    <th className={TH}>Member</th>
                    <th className={TH}>What</th>
                    <th className={TH}>Ref</th>
                    <th className={`${TH} text-right`}>Total</th>
                    <th className={TH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.rows.map((p) => {
                    const [label, tone] = PAY[p.status] ?? [p.status, "neutral" as Tone];
                    return (
                      <tr key={p.id} className={TR}>
                        <td className={TD}>{fmtStamp(p.createdAt)}</td>
                        <td className={TD}>
                          <div>{p.member}</div>
                          <div className="text-xs text-muted">
                            {p.email}
                            {p.gym ? ` · ${p.gym}` : ""}
                          </div>
                        </td>
                        <td className={TD}>
                          {p.what} · {p.kind}
                          {p.couponCode ? <span className="text-muted"> · coupon {p.couponCode}</span> : null}
                          {p.periodEnd ? <span className="text-muted"> · till {fmtShort(p.periodEnd)}</span> : null}
                        </td>
                        <td className={`${TD} font-mono text-xs`}>{p.ref}</td>
                        <td className={`${TD} text-right tabular-nums`}>{formatRupees(p.total)}</td>
                        <td className={TD}>
                          <Badge tone={tone}>{label}</Badge>
                          <div className="text-xs text-muted">{p.status === "PAID" && p.paidAt ? fmtStamp(p.paidAt) : ""}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          <Pager page={payments.page} pageSize={PAGE} total={payments.total} href={(p) => `/fitron-admin/trainer?${qs(p)}`} />
        </Card>
      )}

      {payouts && (
        <Card title={`Gym payouts · ${fmtMonthShort(month)} ${month.slice(0, 4)}`} action={<LinkButton href={`/fitron-admin/trainer/csv?what=payouts&month=${month}`} variant="ghost">Download CSV</LinkButton>}>
          <div className="mb-4 flex flex-wrap gap-2">
            {months.map((m) => (
              <Link key={m} href={`/fitron-admin/trainer?tab=payouts&month=${m}`} className={m === month ? "rounded-md bg-accent px-3 py-1.5 text-sm text-accent-ink" : "rounded-md bg-surface px-3 py-1.5 text-sm hover:bg-surface-2"}>
                {fmtMonthShort(m)} {m.slice(0, 4)}
              </Link>
            ))}
          </div>
          {payouts.rows.length === 0 ? (
            <Empty>No gym has linked members yet.</Empty>
          ) : (
            <ScrollRegion label="Trainer plans">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Gym</th>
                    <th className={TH}>Code</th>
                    <th className={`${TH} text-right`}>Linked members</th>
                    <th className={`${TH} text-right`}>Payments</th>
                    <th className={`${TH} text-right`}>Before GST</th>
                    <th className={`${TH} text-right`}>Owed to the gym</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.rows.map((r) => (
                    <tr key={r.id} className={TR}>
                      <td className={TD}>{r.gym}</td>
                      <td className={`${TD} font-mono`}>{r.code ?? "—"}</td>
                      <td className={`${TD} text-right tabular-nums`}>{r.members}</td>
                      <td className={`${TD} text-right tabular-nums`}>{r.payments}</td>
                      <td className={`${TD} text-right tabular-nums`}>{formatRupees(r.base)}</td>
                      <td className={`${TD} text-right font-semibold tabular-nums`}>{formatRupees(r.share)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className={`${TD} font-semibold`} colSpan={3}>
                      Total
                    </td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>{payouts.totals.payments}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>{formatRupees(payouts.totals.base)}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>{formatRupees(payouts.totals.share)}</td>
                  </tr>
                </tbody>
              </table>
            </ScrollRegion>
          )}
          <p className="mt-3 text-xs text-muted">Pay each gym its share in the first week of the next month. The gym sees the same figure on its own Gym Partnership page.</p>
        </Card>
      )}
    </>
  );
}
