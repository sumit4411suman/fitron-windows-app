import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getScenario, scenarioVersusActual } from "@/lib/services/simulator";
import { UserError } from "@/lib/services/errors";
import { parseInputs } from "@/lib/domain/simulator";
import { monthLabel } from "@/lib/domain/periods";
import { fmtDate, formatRupees } from "@/lib/format";
import { Card, LinkButton, Notice, ScrollRegion, TABLE, TD, TH, TR, cx } from "@/components/ui";
import { ActionButton } from "@/components/action-form";
import { IntelligenceShell, KindBadge, SIM_NOTE } from "../../_ui";
import { ScenarioEditor } from "../scenario-editor";
import { archiveScenarioAction, duplicateScenarioAction, saveScenarioAction } from "../actions";

export const metadata = { title: "Scenario · Fitron" };

export default async function ScenarioPage({ params }: PageProps<"/intelligence/simulator/[id]">) {
  const u = await requirePermission("accounting.view");
  const { id } = await params;
  let s: Awaited<ReturnType<typeof getScenario>>;
  try {
    s = await getScenario(u, id);
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }
  const inputs = parseInputs(s.inputs);
  const baseline = parseInputs((s.baseline as { inputs?: unknown } | null)?.inputs);
  const vs = await scenarioVersusActual(u, id);
  const archived = !!s.archivedAt;

  return (
    <IntelligenceShell
      u={u}
      current="/intelligence/simulator"
      title={s.name}
      subtitle={`Baseline read from the books for ${fmtDate(s.baselineFrom)} to ${fmtDate(s.baselineTo)} · saved ${fmtDate(s.createdAt.toISOString().slice(0, 10))} · formula v${s.calcVersion}${archived ? " · archived" : ""}`}
      actions={
        <>
          <LinkButton href={`/intelligence/simulator/${s.id}/csv`} variant="default" prefetch={false}>
            Export report (CSV)
          </LinkButton>
          <ActionButton action={duplicateScenarioAction.bind(null, s.id)} label="Duplicate" />
          <ActionButton action={archiveScenarioAction.bind(null, s.id, !archived)} label={archived ? "Restore" : "Archive"} variant={archived ? "default" : "ghost"} />
        </>
      }
    >
      {archived && <Notice tone="neutral">This scenario is archived and read-only. Duplicate it to work on a copy.</Notice>}
      {vs.months.length > 0 && (
        <Card title="Forecast against what the books showed" action={<KindBadge kind="actual" />}>
          <p className="m-0 mb-3 text-[12px] text-muted">The forecast&apos;s months that have passed since it was saved, against the Profit &amp; loss and membership figures for those months.</p>
          <ScrollRegion label="Forecast versus actual">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Month</th>
                  <th className={TH}>Figure</th>
                  <th className={cx(TH, "text-right")}>Forecast</th>
                  <th className={cx(TH, "text-right")}>Actual</th>
                  <th className={cx(TH, "text-right")}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {vs.months.flatMap((m) =>
                  m.rows.map((r, i) => (
                    <tr key={`${m.month}${r.label}`} className={TR}>
                      <td className={cx(TD, "whitespace-nowrap")}>{i === 0 ? monthLabel(m.month) : ""}</td>
                      <td className={TD}>{r.label}</td>
                      <td className={cx(TD, "text-right tabular-nums")}>{r.label === "Active members" ? r.forecast : formatRupees(r.forecast)}</td>
                      <td className={cx(TD, "text-right tabular-nums")}>{r.label === "Active members" ? r.actual : formatRupees(r.actual)}</td>
                      <td className={cx(TD, "text-right tabular-nums", r.delta >= 0 ? "text-ok" : "text-alert")}>
                        {r.label === "Active members" ? r.delta : formatRupees(r.delta)}
                        {r.deltaPct !== null && <span className="text-muted"> ({r.deltaPct}%)</span>}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </ScrollRegion>
        </Card>
      )}
      <Notice tone="neutral">{SIM_NOTE}</Notice>
      <ScenarioEditor inputs={inputs} baseline={baseline} name={s.name} note={s.note ?? ""} save={archived ? null : saveScenarioAction.bind(null, s.id)} saveLabel="Save changes" />
    </IntelligenceShell>
  );
}
