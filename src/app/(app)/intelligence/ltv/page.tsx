import Link from "next/link";
import { requirePermission } from "@/lib/auth/current";
import { addDays } from "@/lib/domain/dates";
import { RETENTION_POINTS } from "@/lib/domain/ltv";
import { monthLabel } from "@/lib/domain/periods";
import { activeTrend, ltvReport, segmentMembers } from "@/lib/services/ltv";
import { membershipFacts } from "@/lib/services/analytics";
import { todayIso } from "@/lib/services/time";
import { fmtDate, fmtMonthShort, formatRupees } from "@/lib/format";
import { Card, Empty, Notice, ScrollRegion, Select, TABLE, TD, TH, TR, cx } from "@/components/ui";
import { Columns, IntelligenceShell, KindBadge, MetricTile, PeriodFilter, Tiles, periodFromQuery } from "../_ui";

export const metadata = { title: "Member Lifetime Value · Fitron" };

export default async function LtvPage({ searchParams }: PageProps<"/intelligence/ltv">) {
  const u = await requirePermission("accounting.view");
  const sp = await searchParams;
  const today = todayIso();
  const period = periodFromQuery(sp, today, { from: addDays(today, -365), to: today });
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 80) : "");
  const filters = { plan: s("plan") || undefined, source: s("source") || undefined };
  const r = await ltvReport(u, period, filters, today);
  const by = s("by") === "plan" || s("by") === "source" || s("by") === "branch" ? (s("by") as "plan" | "source" | "branch") : null;
  const key = s("key");
  const drill = by && key && u.can("members.view") ? await segmentMembers(u, by, key, today) : null;
  const trend = activeTrend(await membershipFacts(u), today, 12);
  const keep = { plan: filters.plan, source: filters.source };
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ from: period.from, to: period.to, ...keep, ...over })) if (v) p.set(k, v);
    return `/intelligence/ltv?${p}`;
  };

  return (
    <IntelligenceShell u={u} current="/intelligence/ltv" title="Member Lifetime Value" subtitle="What members are worth and how long they stay, from memberships and invoices: historical revenue, tenure, renewals, retention by signup month, value by plan and source, and an estimate of lifetime value that is only shown when the data can carry it.">
      <PeriodFilter from={period.from} to={period.to} keep={keep}>
        <Select name="plan" defaultValue={filters.plan ?? ""} aria-label="Plan" className="w-auto!">
          <option value="">Every plan</option>
          {r.options.plans.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select name="source" defaultValue={filters.source ?? ""} aria-label="Source" className="w-auto!">
          <option value="">Every source</option>
          {r.options.sources.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <span className="text-[13px] text-muted">{r.members} members in view · {r.activeMembers} active today</span>
      </PeriodFilter>

      {r.members === 0 ? (
        <Empty>No members match. Member value needs members with at least one membership; add or import them first.</Empty>
      ) : (
        <>
          <Tiles>
            {r.metrics.map((m) => (
              <MetricTile key={m.id} m={m} sub={m.id === "ltv.renewalRate" ? `${r.renewal.renewed} of ${r.renewal.ended} renewed${r.renewal.pending ? ` · ${r.renewal.pending} still within the window` : ""}` : m.id === "ltv.cancellation" ? `${r.cancellation.cancelled} of ${r.cancellation.sold} sold` : m.id === "ltv.revenue" ? `${r.withMembership} members with a membership` : undefined} />
            ))}
          </Tiles>

          <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
            <Card title="Active members, month by month">
              <Columns label="Active members at month end" series={trend.map((t) => ({ label: fmtMonthShort(t.month), value: t.active }))} />
            </Card>
            <Card title="Lifetime value: the basis of the estimate">
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Monthly revenue per active member</dt>
                <dd className="m-0 tabular-nums">{r.estimate.basis.monthlyRevenuePerActive === null ? "—" : formatRupees(r.estimate.basis.monthlyRevenuePerActive)}</dd>
                <dt className="text-muted">Monthly churn (last {r.estimate.basis.churnWindowMonths} months)</dt>
                <dd className="m-0 tabular-nums">{r.estimate.basis.monthlyChurnPct === null ? "—" : `${r.estimate.basis.monthlyChurnPct}% (${r.estimate.basis.membersLost} of ${r.estimate.basis.membersAtStart} covered then are not covered today)`}</dd>
                <dt className="text-muted">Months of history</dt>
                <dd className="m-0 tabular-nums">{r.estimate.basis.monthsOfHistory}</dd>
                <dt className="text-muted">Model</dt>
                <dd className="m-0">
                  Revenue per member per month ÷ monthly churn. <KindBadge kind="estimate" /> Gross revenue, not profit; assumes today&apos;s churn holds.
                </dd>
              </dl>
              {r.estimate.value === null && <Notice tone="neutral">Not shown: {r.estimate.warnings.join(" ")}</Notice>}
            </Card>
          </div>

          <Card title="Retention by signup month" action={<span className="text-[13px] text-muted">Of those who joined in the month, still covered by a membership N months later</span>}>
            <ScrollRegion label="Cohort retention">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Joined in</th>
                    <th className={cx(TH, "text-right")}>Members</th>
                    {Object.keys(RETENTION_POINTS).map((k) => (
                      <th key={k} className={cx(TH, "text-right")}>
                        {k.replace("m", "")} mo
                      </th>
                    ))}
                    <th className={cx(TH, "text-right")}>Revenue</th>
                    <th className={cx(TH, "text-right")}>Per member</th>
                    <th className={cx(TH, "text-right")}>Avg tenure</th>
                  </tr>
                </thead>
                <tbody>
                  {r.cohorts.map((c) => (
                    <tr key={c.cohort} className={TR}>
                      <td className={cx(TD, "whitespace-nowrap")}>{monthLabel(c.cohort)}</td>
                      <td className={cx(TD, "text-right")}>{c.members}</td>
                      {(Object.keys(RETENTION_POINTS) as (keyof typeof RETENTION_POINTS)[]).map((k) => (
                        <td key={k} className={cx(TD, "text-right tabular-nums", c.retained[k] === null && "text-faint")} title={c.retained[k] === null ? "Too recent to observe" : undefined}>
                          {c.retained[k] === null ? "n/a" : `${c.retained[k]}%`}
                        </td>
                      ))}
                      <td className={cx(TD, "text-right tabular-nums")}>{formatRupees(c.revenue)}</td>
                      <td className={cx(TD, "text-right tabular-nums")}>{formatRupees(c.revenuePerMember)}</td>
                      <td className={cx(TD, "text-right tabular-nums")}>{c.avgTenure === null ? "—" : `${c.avgTenure} mo`}</td>
                    </tr>
                  ))}
                  {r.cohorts.length === 0 && (
                    <tr>
                      <td className={cx(TD, "text-muted")} colSpan={8}>
                        No one joined in the last twelve months.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollRegion>
            <p className="mt-2 text-[12px] text-muted">n/a: the cohort is too young for that point to be observed. Revenue is all memberships of the cohort to date, net of discounts, before GST.</p>
          </Card>

          <div className="grid gap-5 lg:grid-cols-3">
            <Segment title="By plan (latest plan held)" by="plan" rows={r.byPlan} href={href} canDrill={u.can("members.view")} />
            <Segment title="By acquisition source" by="source" rows={r.bySource} href={href} canDrill={u.can("members.view")} />
            {r.byBranch.length > 0 ? <Segment title="By branch" by="branch" rows={r.byBranch} href={href} canDrill={u.can("members.view")} /> : <Card title="By branch"><p className="text-sm text-muted">Pick All branches in the header to compare branches.</p></Card>}
          </div>

          {drill && (
            <Card title={`Members: ${key} (${by})`} action={<Link href={href({ by: undefined, key: undefined })} className="text-[13px] text-muted hover:text-accent">Close</Link>}>
              <ScrollRegion label="Members in the segment" className="max-h-[480px]">
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th className={TH}>Member</th>
                      <th className={TH}>Joined</th>
                      <th className={cx(TH, "text-right")}>Tenure</th>
                      <th className={cx(TH, "text-right")}>Revenue</th>
                      <th className={TH}>Today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill.map((m) => (
                      <tr key={m.id} className={TR}>
                        <td className={TD}>
                          <Link href={`/members/${m.id}`} className="hover:text-accent">
                            {m.name}
                          </Link>
                          <span className="block text-xs text-muted">{m.code} · {m.phone}</span>
                        </td>
                        <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(m.joined)}</td>
                        <td className={cx(TD, "text-right tabular-nums")}>{m.tenure === null ? "—" : `${m.tenure} mo`}</td>
                        <td className={cx(TD, "text-right tabular-nums")}>{formatRupees(m.revenue)}</td>
                        <td className={TD}>{m.active ? "Active" : "Not covered"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
              <p className="mt-2 text-[12px] text-muted">Shown to roles that may see members; up to 500 rows.</p>
            </Card>
          )}

          <Notice tone="neutral">
            <strong>Data notes.</strong> {r.completeness.join(" ")}
          </Notice>
        </>
      )}
    </IntelligenceShell>
  );
}

function Segment({ title, by, rows, href, canDrill }: { title: string; by: "plan" | "source" | "branch"; rows: { key: string; members: number; active: number; revenue: number; revenuePerMember: number; avgTenure: number | null }[]; href: (o: Record<string, string | undefined>) => string; canDrill: boolean }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing to compare.</p>
      ) : (
        <ScrollRegion label={title}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Segment</th>
                <th className={cx(TH, "text-right")}>Members</th>
                <th className={cx(TH, "text-right")}>Active</th>
                <th className={cx(TH, "text-right")}>Rev./member</th>
                <th className={cx(TH, "text-right")}>Tenure</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key} className={TR}>
                  <td className={TD}>{canDrill ? <Link href={href({ by, key: s.key })} className="hover:text-accent">{s.key}</Link> : s.key}</td>
                  <td className={cx(TD, "text-right")}>{s.members}</td>
                  <td className={cx(TD, "text-right")}>{s.active}</td>
                  <td className={cx(TD, "text-right tabular-nums")}>{formatRupees(s.revenuePerMember)}</td>
                  <td className={cx(TD, "text-right tabular-nums")}>{s.avgTenure === null ? "—" : `${s.avgTenure} mo`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </Card>
  );
}
