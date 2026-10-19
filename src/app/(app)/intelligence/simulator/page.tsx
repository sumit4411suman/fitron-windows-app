import Link from "next/link";
import { requirePermission } from "@/lib/auth/current";
import { listScenarios, scenarioResult } from "@/lib/services/simulator";
import { parseInputs, simulate } from "@/lib/domain/simulator";
import { fmtDate, fmtStamp, formatRupees } from "@/lib/format";
import { Badge, Card, Empty, LinkButton, ScrollRegion, TABLE, TD, TH, TR, cx } from "@/components/ui";
import { IntelligenceShell, SIM_NOTE } from "../_ui";

export const metadata = { title: "Profit Simulator · Fitron" };

export default async function SimulatorPage({ searchParams }: PageProps<"/intelligence/simulator">) {
  const u = await requirePermission("accounting.view");
  const sp = await searchParams;
  const archived = sp.archived === "1";
  const rows = await listScenarios(u, archived);
  const shown = archived ? rows.filter((r) => r.archivedAt) : rows;

  return (
    <IntelligenceShell
      u={u}
      current="/intelligence/simulator"
      title="Profit Simulator"
      subtitle="Change prices, the membership mix, joiners, churn and costs, and see the forecast, break-even and sensitivity at once. The baseline is read from your books; a scenario is a saved set of assumptions and never changes a record."
      actions={
        <LinkButton href="/intelligence/simulator/new" variant="primary">
          New scenario
        </LinkButton>
      }
    >
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <Link href="/intelligence/simulator" className={cx("rounded-md px-3 py-1.5", !archived ? "bg-accent-soft text-accent-strong" : "hover:bg-fg/7")}>
          Saved
        </Link>
        <Link href="/intelligence/simulator?archived=1" className={cx("rounded-md px-3 py-1.5", archived ? "bg-accent-soft text-accent-strong" : "hover:bg-fg/7")}>
          Archived
        </Link>
      </div>
      {shown.length === 0 ? (
        <Empty>{archived ? "No archived scenarios." : "No scenarios yet. Start one from your books: the current membership mix, prices and the last three months' costs are filled in, and you change what you want to test."}</Empty>
      ) : (
        <Card title={archived ? "Archived scenarios" : "Saved scenarios"}>
          <ScrollRegion label="Scenarios">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Scenario</th>
                  <th className={TH}>Baseline read</th>
                  <th className={cx(TH, "text-right")}>Months</th>
                  <th className={cx(TH, "text-right")}>Forecast operating profit</th>
                  <th className={cx(TH, "text-right")}>Against the books then</th>
                  <th className={cx(TH, "text-right")}>Break-even members</th>
                  <th className={TH}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const inputs = parseInputs(s.inputs);
                  const { result, recomputed } = scenarioResult(s);
                  const base = (s.baseline as { inputs?: unknown } | null)?.inputs;
                  const against = base ? result.totals.operatingProfit - simulate({ ...parseInputs(base), months: inputs.months }).totals.operatingProfit : null;
                  return (
                    <tr key={s.id} className={TR}>
                      <td className={TD}>
                        <Link href={`/intelligence/simulator/${s.id}`} className="font-semibold hover:text-accent">
                          {s.name}
                        </Link>
                        {s.note && <span className="block max-w-[360px] truncate text-xs text-muted">{s.note}</span>}
                        {recomputed && <Badge tone="neutral">Recomputed with the current formula</Badge>}
                      </td>
                      <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(s.baselineFrom)} – {fmtDate(s.baselineTo)}</td>
                      <td className={cx(TD, "text-right")}>{inputs.months}</td>
                      <td className={cx(TD, "text-right font-semibold tabular-nums", result.totals.operatingProfit < 0 && "text-alert")}>{formatRupees(result.totals.operatingProfit)}</td>
                      <td className={cx(TD, "text-right tabular-nums", against !== null && (against >= 0 ? "text-ok" : "text-alert"))}>{against === null ? "—" : `${against >= 0 ? "+" : "−"}${formatRupees(Math.abs(against))}`}</td>
                      <td className={cx(TD, "text-right")}>{result.breakEvenMembers ?? "—"}</td>
                      <td className={cx(TD, "whitespace-nowrap text-muted")}>{fmtStamp(s.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
          <p className="mt-3 text-[12px] text-muted">{SIM_NOTE}</p>
        </Card>
      )}
    </IntelligenceShell>
  );
}
