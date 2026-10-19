import Link from "next/link";
import { requirePermission } from "@/lib/auth/current";
import { BENCH_METRICS } from "@/lib/domain/benchmark";
import { externalBenchmark, getBenchmarkConsent, internalBenchmark } from "@/lib/services/benchmark";
import { todayIso } from "@/lib/services/time";
import { isLocal } from "@/lib/runtime/edition";
import { fmtDate, fmtStamp, formatRupees } from "@/lib/format";
import { Badge, Card, Empty, Notice, ScrollRegion, TABLE, TD, TH, TR, cx } from "@/components/ui";
import { ActionButton } from "@/components/action-form";
import { IntelligenceShell, KindBadge, PeriodFilter, periodFromQuery } from "../_ui";
import { consentAction } from "./actions";

export const metadata = { title: "Benchmarking · Fitron" };

const fmt = (v: number | null, unit: "paise" | "count" | "pct") => (v === null ? "—" : unit === "paise" ? formatRupees(v) : unit === "pct" ? `${v}%` : v.toLocaleString("en-IN"));

export default async function BenchmarkingPage({ searchParams }: PageProps<"/intelligence/benchmarking">) {
  const u = await requirePermission("accounting.view");
  const sp = await searchParams;
  const today = todayIso();
  const period = periodFromQuery(sp, today);
  const internalOpen = u.has("analytics");
  const [internal, external, consent] = await Promise.all([internalOpen ? internalBenchmark(u, period, today) : null, externalBenchmark(u, today), getBenchmarkConsent(u.orgId)]);

  return (
    <IntelligenceShell u={u} current="/intelligence/benchmarking" title="Benchmarking & Franchise Intelligence" subtitle="Your branches against each other over the same period, by metrics defined below; and, where enough gyms have opted in, your gym against an anonymised peer group. A better figure is a difference to ask about, not a cause.">
      <Card title="Your branches" action={<KindBadge kind="actual" />}>
        {!internalOpen ? (
          <Notice tone="accent">
            Branch comparison is on the Enterprise plan.{" "}
            {u.can("settings.manage") ? (
              <Link href="/settings/billing?upgrade=analytics" className="font-semibold underline">
                See plans
              </Link>
            ) : (
              "Ask a Super Admin to upgrade."
            )}
          </Notice>
        ) : internal!.rows.length < 2 ? (
          <Empty>{u.branchIds.length < 2 ? "This gym has one branch in view. Pick All branches in the header, or add a branch in Settings, to compare." : "Nothing to compare yet."}</Empty>
        ) : (
          <>
            <div className="mb-3">
              <PeriodFilter from={period.from} to={period.to} />
            </div>
            <ScrollRegion label="Branch comparison">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Metric</th>
                    {internal!.rows.map((b) => (
                      <th key={b.id} className={cx(TH, "text-right")}>
                        {b.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BENCH_METRICS.map((m) => (
                    <tr key={m.key} className={TR}>
                      <td className={TD}>
                        {m.label}
                        <span className="block text-xs text-muted">{m.definition} {m.higherIsBetter ? "" : "Lower is better."}</span>
                      </td>
                      {internal!.rows.map((b) => (
                        <td key={b.id} className={cx(TD, "text-right tabular-nums align-top")}>
                          <span className={cx(b.rank[m.key] === 1 && "font-semibold")}>{fmt(b.metrics[m.key], m.unit)}</span>
                          {b.rank[m.key] !== null && <Badge tone={b.rank[m.key] === 1 ? "ok" : "neutral"}>#{b.rank[m.key]}</Badge>}
                          <span className="block text-xs text-muted">
                            {b.change[m.key] === null ? "no previous period" : `${b.change[m.key]! >= 0 ? "+" : ""}${b.change[m.key]}% vs ${fmtDate(internal!.previous.from)}–${fmtDate(internal!.previous.to)}`}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
            {internal!.rows.some((b) => b.warnings.length) && <p className="mt-2 text-[12px] text-alert">{[...new Set(internal!.rows.flatMap((b) => b.warnings))].join(" ")}</p>}
            <p className="mt-2 text-[12px] text-muted">Each branch&apos;s figures are the same Profit &amp; loss and membership figures its own dashboard shows for the period; ranks follow each metric&apos;s own direction. Open a branch from the header switcher for its detail.</p>
          </>
        )}
      </Card>

      <Card title="Your gym against anonymised peers" action={external.available ? <KindBadge kind="actual" /> : <Badge tone="neutral">Unavailable</Badge>}>
        {external.available ? (
          <>
            <p className="m-0 mb-3 text-sm">
              {external.cohortGyms} other gyms · {external.cohort?.sizeLabel}
              {external.cohort?.state ? ` · ${external.cohort.state}` : " · all states"} · {external.month} · your figures aggregated {fmtStamp(external.freshness ? new Date(external.freshness) : null)}
            </p>
            <ScrollRegion label="Peer comparison">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Metric</th>
                    <th className={cx(TH, "text-right")}>You</th>
                    <th className={cx(TH, "text-right")}>Lower quartile</th>
                    <th className={cx(TH, "text-right")}>Median</th>
                    <th className={cx(TH, "text-right")}>Upper quartile</th>
                    <th className={cx(TH, "text-right")}>Your percentile</th>
                    <th className={cx(TH, "text-right")}>Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {external.comparisons.map((c) => {
                    const m = BENCH_METRICS.find((x) => x.key === c.key)!;
                    return (
                      <tr key={c.key} className={TR}>
                        <td className={TD}>
                          {m.label}
                          {c.unavailable && <span className="block text-xs text-muted">{c.unavailable}</span>}
                        </td>
                        <td className={cx(TD, "text-right font-semibold tabular-nums")}>{fmt(c.value, m.unit)}</td>
                        <td className={cx(TD, "text-right tabular-nums")}>{fmt(c.p25, m.unit)}</td>
                        <td className={cx(TD, "text-right tabular-nums")}>{fmt(c.median, m.unit)}</td>
                        <td className={cx(TD, "text-right tabular-nums")}>{fmt(c.p75, m.unit)}</td>
                        <td className={cx(TD, "text-right tabular-nums")}>{c.percentile === null ? "—" : `${c.percentile}th`}</td>
                        <td className={cx(TD, "text-right tabular-nums")}>{c.sample}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollRegion>
          </>
        ) : (
          <Notice tone="neutral">{external.reason}</Notice>
        )}
        <details className="mt-3 text-[12px] text-muted">
          <summary className="cursor-pointer">Methodology and privacy</summary>
          <ul className="mt-1 list-disc pl-5">
            {external.methodology.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </details>
        {!isLocal() && u.can("settings.manage") && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <div className="text-sm">
              {consent.optIn ? <>Sharing is <strong>on</strong> since {consent.consentAt ? fmtDate(consent.consentAt.slice(0, 10)) : "—"}: one aggregated row of this gym&apos;s monthly totals and rates joins the pool each night.</> : <>Sharing is <strong>off</strong>. Opt in to share one aggregated row a month (totals and rates, never a member or an invoice) and see where your gym stands.</>}
            </div>
            <ActionButton action={consentAction.bind(null, !consent.optIn)} label={consent.optIn ? "Stop sharing and remove our figures" : "Opt in to benchmarking"} variant={consent.optIn ? "danger" : "primary"} confirm={consent.optIn ? "Stop sharing? Your gym's rows leave the pool and the comparison closes." : "Share one aggregated row of monthly totals and rates with the peer pool, in return for the comparison?"} />
          </div>
        )}
      </Card>
    </IntelligenceShell>
  );
}
