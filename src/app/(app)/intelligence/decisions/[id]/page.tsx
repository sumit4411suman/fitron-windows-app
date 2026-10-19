import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { DECISION_CATEGORIES, DECISION_STATUS, compareOptions, getDecision, parseCriteria, reviewFigures, type DecisionBaseline, type DecisionCategory, type DecisionStatus } from "@/lib/services/decisions";
import { baselineInputs } from "@/lib/services/simulator";
import { UserError } from "@/lib/services/errors";
import { SCENARIO_LABEL, parseInputs } from "@/lib/domain/simulator";
import { toIso, todayIso } from "@/lib/services/time";
import { fmtDate, fmtStamp, formatRupees } from "@/lib/format";
import { Badge, Card, Notice, ScrollRegion, TABLE, TD, TH, TR, cx } from "@/components/ui";
import { ActionButton } from "@/components/action-form";
import { IntelligenceShell, KindBadge, SIM_NOTE } from "../../_ui";
import { DecisionForm } from "../decision-form";
import { OptionEditor, VerdictForms } from "./option-editor";
import { removeOptionAction } from "../actions";

export const metadata = { title: "Decision · Fitron" };

const TONE: Record<string, "neutral" | "accent" | "alert" | "ok"> = { DRAFT: "neutral", APPROVED: "accent", REJECTED: "alert", DEFERRED: "neutral", IMPLEMENTED: "ok", REVIEWED: "ok" };

export default async function DecisionPage({ params, searchParams }: PageProps<"/intelligence/decisions/[id]">) {
  const u = await requirePermission("accounting.view");
  const { id } = await params;
  const sp = await searchParams;
  let d: Awaited<ReturnType<typeof getDecision>>;
  try {
    d = await getDecision(u, id);
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }
  const criteria = parseCriteria(d.criteria);
  const cmp = compareOptions(d.options, criteria);
  const baseline = d.baseline as unknown as DecisionBaseline;
  const editable = !["IMPLEMENTED", "REVIEWED"].includes(d.status);
  const editing = typeof sp.edit === "string" ? sp.edit : null;
  const editingOption = editing === "new" ? null : d.options.find((o) => o.id === editing);
  const simBase = editable ? await baselineInputs(u) : null;
  const review = d.implementedOn ? await reviewFigures(u, id, todayIso()) : null;
  const canDecide = u.can("settings.manage");
  const money = (p: number) => formatRupees(p);

  return (
    <IntelligenceShell
      u={u}
      current="/intelligence/decisions"
      title={d.title}
      subtitle={
        <>
          {DECISION_CATEGORIES[d.category as DecisionCategory] ?? d.category} · <Badge tone={TONE[d.status] ?? "neutral"}>{DECISION_STATUS[d.status as DecisionStatus] ?? d.status}</Badge> · version {d.version} · baseline read {fmtDate(baseline.from)} to {fmtDate(baseline.to)}
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card title="Objective and constraints">
          <p className="m-0 text-sm whitespace-pre-wrap">{d.objective}</p>
          {d.constraints && (
            <p className="m-0 mt-2 text-sm whitespace-pre-wrap">
              <span className="text-muted">Constraints: </span>
              {d.constraints}
            </p>
          )}
          {d.rationale && (
            <p className="m-0 mt-2 text-sm whitespace-pre-wrap">
              <span className="text-muted">Reasoning ({DECISION_STATUS[d.status as DecisionStatus]?.toLowerCase()}): </span>
              {d.rationale}
            </p>
          )}
          {editable && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-muted">Edit the objective, constraints or category (saved as a new revision)</summary>
              <div className="mt-3">
                <DecisionForm decision={{ id: d.id, title: d.title, category: d.category, objective: d.objective, constraints: d.constraints, reviewDays: d.reviewDays }} />
              </div>
            </details>
          )}
        </Card>
        <Card title="Baseline when the decision was made" action={<KindBadge kind="actual" />}>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Revenue</dt>
            <dd className="m-0 tabular-nums">{money(baseline.revenue)}</dd>
            <dt className="text-muted">Operating expenses</dt>
            <dd className="m-0 tabular-nums">{money(baseline.expenses)}</dd>
            <dt className="text-muted">Operating profit</dt>
            <dd className="m-0 tabular-nums">{money(baseline.net)}</dd>
            <dt className="text-muted">Active members</dt>
            <dd className="m-0 tabular-nums">{baseline.activeMembers}</dd>
            <dt className="text-muted">New members</dt>
            <dd className="m-0 tabular-nums">{baseline.newMembers}</dd>
            <dt className="text-muted">Renewal rate</dt>
            <dd className="m-0 tabular-nums">{baseline.renewalRate === null ? "—" : `${baseline.renewalRate}%`}</dd>
          </dl>
          <p className="mt-2 text-[12px] text-muted">Three months to {fmtDate(baseline.to)}, read {fmtDate(baseline.readAt.slice(0, 10))}.</p>
        </Card>
      </div>

      <Card title="Options side by side" action={<span className="text-[13px] text-muted">Calculated figures from the Profit Simulator; scores are yours (1–5)</span>}>
        <ScrollRegion label="Options comparison">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>&nbsp;</th>
                {cmp.map((o) => (
                  <th key={o.id} className={cx(TH, "text-right")}>
                    {o.name}
                    {o.id === d.selectedId && <Badge tone="ok">Chosen</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className={TR}>
                <td className={cx(TD, "text-muted")} colSpan={cmp.length + 1}>
                  Calculated over the option&apos;s own forecast months · <KindBadge kind="forecast" />
                </td>
              </tr>
              {(["revenue", "operatingExpenses", "operatingProfit"] as const).map((k) => (
                <tr key={k} className={TR}>
                  <td className={TD}>{k === "revenue" ? "Revenue (incl. other income, net of refunds)" : k === "operatingExpenses" ? "Operating expenses" : "Operating profit"}</td>
                  {cmp.map((o) => {
                    const v = k === "revenue" ? o.result.totals.revenue + o.result.totals.otherIncome - o.result.totals.refunds : o.result.totals[k];
                    return (
                      <td key={o.id} className={cx(TD, "text-right tabular-nums", k === "operatingProfit" && "font-semibold", v < 0 && "text-alert")}>
                        {money(v)} <span className="text-xs text-muted">/ {o.inputs.months} mo</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className={TR}>
                <td className={TD}>Operating margin</td>
                {cmp.map((o) => (
                  <td key={o.id} className={cx(TD, "text-right tabular-nums")}>
                    {o.result.operatingMarginPct === null ? "—" : `${o.result.operatingMarginPct}%`}
                  </td>
                ))}
              </tr>
              <tr className={TR}>
                <td className={TD}>Break-even members</td>
                {cmp.map((o) => (
                  <td key={o.id} className={cx(TD, "text-right tabular-nums")}>
                    {o.result.breakEvenMembers ?? "—"}
                  </td>
                ))}
              </tr>
              <tr className={TR}>
                <td className={TD}>Members at the end</td>
                {cmp.map((o) => (
                  <td key={o.id} className={cx(TD, "text-right tabular-nums")}>
                    {o.result.totals.activeEnd}
                  </td>
                ))}
              </tr>
              <tr className={TR}>
                <td className={TD}>Operating profit: conservative / optimistic</td>
                {cmp.map((o) => (
                  <td key={o.id} className={cx(TD, "text-right tabular-nums text-muted")} title={`${SCENARIO_LABEL.conservative}: joiners −20%, churn +2 points, costs +5%; ${SCENARIO_LABEL.optimistic}: the reverse`}>
                    {money(o.variants.conservative.totals.operatingProfit)} / {money(o.variants.optimistic.totals.operatingProfit)}
                  </td>
                ))}
              </tr>
              <tr className={TR}>
                <td className={cx(TD, "text-muted")} colSpan={cmp.length + 1}>
                  Weighted criteria · the financial score is worked out from the operating profit above (5 = best option, 1 = worst); the rest are your own judgement
                </td>
              </tr>
              {criteria.map((c) => (
                <tr key={c.key} className={TR}>
                  <td className={TD}>
                    {c.label} <span className="text-xs text-muted">weight {c.weight}</span>
                  </td>
                  {cmp.map((o) => {
                    const p = o.per.find((x) => x.key === c.key)!;
                    return (
                      <td key={o.id} className={cx(TD, "text-right tabular-nums", p.score === null && "text-faint")}>
                        {p.score === null ? "not scored" : `${p.score} / 5`}
                        {p.calculated && <span className="text-xs text-muted"> (calc.)</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className={TR}>
                <td className={cx(TD, "font-semibold")}>Weighted score</td>
                {cmp.map((o) => (
                  <td key={o.id} className={cx(TD, "text-right font-semibold tabular-nums")}>
                    {o.weighted === null ? "—" : `${o.weighted} / 5`}
                    {o.unscored.length > 0 && <span className="block text-xs font-normal text-muted">without {o.unscored.join(", ")}</span>}
                  </td>
                ))}
              </tr>
              <tr className={TR}>
                <td className={TD}>Benefits · costs · risks</td>
                {d.options.map((o) => (
                  <td key={o.id} className={cx(TD, "text-right text-xs")}>
                    {[o.benefits && `+ ${o.benefits}`, o.costs && `− ${o.costs}`, o.risks && `! ${o.risks}`].filter(Boolean).join(" · ") || "—"}
                  </td>
                ))}
              </tr>
              {editable && (
                <tr>
                  <td className={TD}>&nbsp;</td>
                  {d.options.map((o) => (
                    <td key={o.id} className={cx(TD, "text-right")}>
                      <a href={`/intelligence/decisions/${d.id}?edit=${o.id}#option`} className="text-sm text-accent hover:underline">
                        Edit
                      </a>
                      {o.id !== d.selectedId && d.options.length > 1 && <ActionButton action={removeOptionAction.bind(null, d.id, o.id)} label="Remove" variant="ghost" confirm={`Remove the option "${o.name}"?`} className="ml-2 inline-flex" />}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </ScrollRegion>
        <p className="mt-3 text-[12px] text-muted">{SIM_NOTE}</p>
        {editable && !editing && (
          <a id="option" href={`/intelligence/decisions/${d.id}?edit=new#option`} className="mt-3 inline-flex items-center justify-center rounded-md border border-transparent bg-accent px-[18px] py-2.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover">
            Add an option
          </a>
        )}
      </Card>

      {editable && editing && simBase && (
        <Card id="option" title={editingOption ? `Edit option: ${editingOption.name}` : "New option"} action={<a href={`/intelligence/decisions/${d.id}`} className="text-[13px] text-muted hover:text-accent">Cancel</a>}>
          <OptionEditor decisionId={d.id} option={editingOption ? { id: editingOption.id, name: editingOption.name, description: editingOption.description, inputs: parseInputs(editingOption.inputs), scores: (editingOption.scores ?? {}) as Record<string, number>, benefits: editingOption.benefits, costs: editingOption.costs, risks: editingOption.risks } : null} baseline={simBase.inputs} criteria={criteria} />
        </Card>
      )}

      {canDecide && <VerdictForms decision={{ id: d.id, status: d.status, selectedId: d.selectedId, options: d.options.map((o) => ({ id: o.id, name: o.name })), implementedOn: d.implementedOn ? toIso(d.implementedOn) : null }} today={todayIso()} reviewReady={!!review} />}
      {!canDecide && editable && <Notice tone="neutral">A Super Admin approves, rejects or defers the decision and records its implementation and review.</Notice>}

      {review && (
        <Card title={review.ready ? "Review: projection against the books" : "So far: projection against the books (review period still running)"} action={<KindBadge kind="actual" />}>
          <p className="m-0 mb-3 text-[12px] text-muted">
            {fmtDate(review.from)} to {fmtDate(review.to)} ({review.monthsCovered} month{review.monthsCovered === 1 ? "" : "s"}), the chosen option&apos;s forecast for the same number of months, and the baseline when the decision was made (three months, not scaled).
          </p>
          <ScrollRegion label="Review figures">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Figure</th>
                  <th className={cx(TH, "text-right")}>Actual since implementation</th>
                  <th className={cx(TH, "text-right")}>Projected (chosen option)</th>
                  <th className={cx(TH, "text-right")}>Baseline then</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Revenue", review.actual.revenue, review.projected?.revenue, baseline.revenue, true],
                    ["Operating expenses", review.actual.expenses, review.projected?.expenses, baseline.expenses, true],
                    ["Operating profit", review.actual.net, review.projected?.net, baseline.net, true],
                    ["Active members", review.actual.activeMembers, review.projected?.activeMembers, baseline.activeMembers, false],
                    ["New members", review.actual.newMembers, undefined, baseline.newMembers, false],
                    ["Renewal rate", review.actual.renewalRate, undefined, baseline.renewalRate, "pct"],
                  ] as [string, number | null, number | undefined, number | null, boolean | "pct"][]
                ).map(([label, a, p, b, kind]) => {
                  const f = (v: number | null | undefined) => (v === null || v === undefined ? "—" : kind === true ? money(v) : kind === "pct" ? `${v}%` : String(v));
                  return (
                    <tr key={label} className={TR}>
                      <td className={TD}>{label}</td>
                      <td className={cx(TD, "text-right font-semibold tabular-nums")}>{f(a)}</td>
                      <td className={cx(TD, "text-right tabular-nums")}>{f(p)}</td>
                      <td className={cx(TD, "text-right tabular-nums text-muted")}>{f(b)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
          {d.lessons && (
            <p className="m-0 mt-3 text-sm">
              <span className="text-muted">Lessons: </span>
              {d.lessons}
            </p>
          )}
        </Card>
      )}

      <Card title="History">
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
          {d.revisions.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-3">
              <span className="tabular-nums text-muted">v{r.version}</span>
              <span>{r.note}</span>
              <span className="text-muted">{fmtStamp(r.at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </IntelligenceShell>
  );
}
