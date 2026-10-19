import Link from "next/link";
import { requirePermission } from "@/lib/auth/current";
import { RECOVERY_STATUS_LABEL, type RecoveryStatus } from "@/lib/domain/recovery";
import { getRecoveryRules, listCases, recoveryDashboard, refreshQueue } from "@/lib/services/recovery";
import { todayIso, toIso } from "@/lib/services/time";
import { fmtDate, formatRupees } from "@/lib/format";
import { AutoFilter } from "@/components/auto-filter";
import { Tag } from "@/components/tag";
import { Badge, Card, Empty, Input, Pager, ScrollRegion, Select, TABLE, TD, TH, TR, cx } from "@/components/ui";
import { ActionButton } from "@/components/action-form";
import { Bars, IntelligenceShell, MetricTile, PeriodFilter, Tiles, periodFromQuery } from "../_ui";
import { refreshQueueAction } from "./actions";
import { RulesForm } from "./rules-form";

export const metadata = { title: "Revenue Recovery · Fitron" };

const PAGE = 50;

export default async function RecoveryPage({ searchParams }: PageProps<"/intelligence/recovery">) {
  const u = await requirePermission("accounting.view");
  const sp = await searchParams;
  const today = todayIso();
  const period = periodFromQuery(sp, today);
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const kind = s("kind") === "DUES" || s("kind") === "RENEWAL" ? s("kind") : "";
  const status = s("status") === "closed" ? "closed" : s("status") === "all" ? "all" : "open";
  const q = s("q").slice(0, 60);
  const page = Math.max(1, Number(sp.p) || 1);
  // The queue is derived from the books: bring it up to date before showing it (idempotent).
  await refreshQueue(u, today);
  const [d, list, rules] = await Promise.all([recoveryDashboard(u, period, today), listCases(u, { kind: kind || undefined, status, q, page, pageSize: PAGE }), getRecoveryRules(u.orgId)]);
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ from: period.from, to: period.to, kind, status, q, ...over })) if (v) p.set(k, v);
    return `/intelligence/recovery?${p}`;
  };

  return (
    <IntelligenceShell
      u={u}
      current="/intelligence/recovery"
      title="Revenue Recovery"
      subtitle="Every invoice still owed past its due date and every membership that lapsed without a renewal, as a work queue with a recommended next step. Payments are recorded through the same Collect payment as the front desk; a renewal opportunity is never counted as a debt."
      actions={<ActionButton action={refreshQueueAction} label="Refresh from the books" />}
    >
      <PeriodFilter from={period.from} to={period.to} keep={{ kind, status, q }} />
      <Tiles>
        {d.metrics.map((m) => (
          <MetricTile key={m.id} m={m} sub={m.id === "recovery.rate" ? `Denominator ${formatRupees(d.denominator)}` : m.id === "recovery.pending" ? `${d.openCases} open cases · ${d.renewalOpportunities} renewal opportunities` : undefined} />
        ))}
      </Tiles>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Outstanding by age">
          <Bars label="Outstanding by ageing bucket" money rows={d.aging.map((a) => ({ label: a.bucket, value: a.amount, hint: `${a.count} invoice${a.count === 1 ? "" : "s"}` }))} />
          <p className="mt-2 text-[12px] text-muted">Open cases only; days past the due date.</p>
        </Card>
        <Card title="By branch">
          {d.byBranch.length > 1 ? (
            <ScrollRegion label="Recovery by branch">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Branch</th>
                    <th className={cx(TH, "text-right")}>Open</th>
                    <th className={cx(TH, "text-right")}>Outstanding</th>
                    <th className={cx(TH, "text-right")}>Recovered</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byBranch.map((b) => (
                    <tr key={b.id} className={TR}>
                      <td className={TD}>{b.name}</td>
                      <td className={cx(TD, "text-right")}>{b.open}</td>
                      <td className={cx(TD, "text-right tabular-nums")}>{formatRupees(b.outstanding)}</td>
                      <td className={cx(TD, "text-right tabular-nums")}>{formatRupees(b.recovered)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          ) : (
            <p className="text-sm text-muted">One branch in view: pick All branches in the header to compare.</p>
          )}
        </Card>
        <Card title="By membership plan">
          {d.byPlan.length ? (
            <ScrollRegion label="Recovery by plan">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Plan</th>
                    <th className={cx(TH, "text-right")}>Open</th>
                    <th className={cx(TH, "text-right")}>Outstanding</th>
                    <th className={cx(TH, "text-right")}>Recovered</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byPlan.map((p) => (
                    <tr key={p.plan} className={TR}>
                      <td className={TD}>{p.plan}</td>
                      <td className={cx(TD, "text-right")}>{p.open}</td>
                      <td className={cx(TD, "text-right tabular-nums")}>{formatRupees(p.outstanding)}</td>
                      <td className={cx(TD, "text-right tabular-nums")}>{formatRupees(p.recovered)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          ) : (
            <p className="text-sm text-muted">No open dues cases.</p>
          )}
        </Card>
      </div>

      <Card title="Work queue" action={<span className="text-[13px] text-muted">{list.total} case{list.total === 1 ? "" : "s"} · highest priority first</span>}>
        <AutoFilter className="mb-3 flex flex-wrap items-center gap-2.5">
          <input type="hidden" name="from" value={period.from} />
          <input type="hidden" name="to" value={period.to} />
          <Select name="kind" defaultValue={kind} aria-label="Kind" className="w-auto!">
            <option value="">Dues and renewals</option>
            <option value="DUES">Dues only</option>
            <option value="RENEWAL">Renewal opportunities only</option>
          </Select>
          <Select name="status" defaultValue={status} aria-label="Status" className="w-auto!">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </Select>
          <Input type="search" name="q" defaultValue={q} placeholder="Member name, phone or ID" aria-label="Search" className="max-w-[280px]" />
        </AutoFilter>
        {list.rows.length === 0 ? (
          <Empty>{status === "open" ? "Nothing to chase: no invoice is past due above the rules' minimum and no membership lapsed in the renewal window." : "No cases match."}</Empty>
        ) : (
          <ScrollRegion label="Recovery queue">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Member</th>
                  <th className={TH}>Case</th>
                  <th className={cx(TH, "text-right")}>Amount</th>
                  <th className={TH}>Age</th>
                  <th className={cx(TH, "text-right")}>Priority</th>
                  <th className={TH}>Next step</th>
                  <th className={TH}>Attempts</th>
                  <th className={TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((c) => (
                  <tr key={c.id} className={TR}>
                    <td className={TD}>
                      <Link href={`/intelligence/recovery/${c.id}`} className="font-semibold hover:text-accent">
                        {c.member.name}
                      </Link>
                      <span className="block text-xs text-muted">{c.member.code} · {c.member.phone}</span>
                    </td>
                    <td className={TD}>
                      {c.kind === "DUES" ? (
                        <>
                          <Badge tone="alert">Dues</Badge> <span className="text-xs text-muted">{c.invoice?.number}</span>
                        </>
                      ) : (
                        <Badge tone="accent">Renewal</Badge>
                      )}
                    </td>
                    <td className={cx(TD, "text-right font-semibold tabular-nums")}>
                      {c.kind === "DUES" ? formatRupees(c.balance) : <span className="text-muted" title="The last plan's net price: an opportunity, not a debt">{formatRupees(c.openingAmount)}</span>}
                    </td>
                    <td className={cx(TD, "whitespace-nowrap")}>{c.kind === "DUES" ? (c.overdueDays ? `${c.overdueDays} days overdue` : "Part paid") : `opened ${fmtDate(toIso(c.openedAt))}`}</td>
                    <td className={cx(TD, "text-right tabular-nums")}>{c.priority}</td>
                    <td className={TD}>
                      {c.nextAction}
                      {c.nextActionOn && <span className={cx("block text-xs", c.dueToday ? "text-alert" : "text-muted")}>{c.dueToday ? "due now" : `from ${fmtDate(toIso(c.nextActionOn))}`}</span>}
                    </td>
                    <td className={TD}>{c.attempts}</td>
                    <td className={TD}>
                      <Tag label={RECOVERY_STATUS_LABEL[c.status as RecoveryStatus] ?? c.status} style={c.status === "RECOVERED" || c.status === "RENEWED" ? 0 : c.status === "CLOSED" ? "neutral" : c.status === "IN_PROGRESS" ? 1 : 4} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        <div className="mt-3">
          <Pager page={list.page} pageSize={PAGE} total={list.total} href={(p) => qs({ p: p > 1 ? String(p) : undefined })} />
        </div>
      </Card>

      {u.can("settings.manage") && (
        <Card title="Recovery rules">
          <RulesForm rules={rules} />
        </Card>
      )}
    </IntelligenceShell>
  );
}
