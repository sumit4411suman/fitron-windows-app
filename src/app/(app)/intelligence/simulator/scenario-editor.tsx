"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FIXED_KEYS, FIXED_LABELS, SCENARIO_LABEL, checkInputs, sensitivity, simulate, threeScenarios, type FixedCosts, type SimInputs, type SimResult } from "@/lib/domain/simulator";
import type { FormState } from "@/lib/validation/common";
import { Button, Field, Input, Notice, ScrollRegion, Select, TABLE, TD, TH, TR, cx } from "@/components/ui";
import { formatRupees } from "@/lib/format";

// The Profit Simulator's editor: every change recalculates at once in the browser with the same deterministic engine
// the server uses (src/lib/domain/simulator.ts), so the figures seen are the figures saved. Nothing here reads or
// writes the books; Save stores the assumptions and the result as a Scenario.

type Props = {
  inputs: SimInputs;
  baseline: SimInputs;
  name?: string;
  note?: string;
  /** Saves the scenario; null for a read-only view (a decision option shown inline). */
  save: ((s: FormState, fd: FormData) => Promise<FormState>) | null;
  saveLabel?: string;
  /** Extra fields rendered inside the save form (a decision option's scores). */
  extra?: React.ReactNode;
  compact?: boolean;
};

const rupeesIn = (p: number) => (p / 100).toString();
const toPaise = (s: string) => Math.round((Number(s.replace(/[₹,\s]/g, "")) || 0) * 100);
const num = (s: string) => Number(s) || 0;

export function ScenarioEditor({ inputs: initial, baseline, name = "", note = "", save, saveLabel = "Save scenario", extra, compact }: Props) {
  const [i, setI] = useState<SimInputs>(initial);
  const result = useMemo(() => simulate(i), [i]);
  const base = useMemo(() => simulate({ ...baseline, months: i.months }), [baseline, i.months]);
  const check = useMemo(() => checkInputs(i), [i]);
  const three = useMemo(() => threeScenarios(i), [i]);
  const sens = useMemo(() => sensitivity(i), [i]);
  const set = <K extends keyof SimInputs>(k: K, v: SimInputs[K]) => setI((x) => ({ ...x, [k]: v }));
  const setFixed = (k: keyof FixedCosts, v: number) => setI((x) => ({ ...x, fixed: { ...x.fixed, [k]: v } }));
  const setPlan = (idx: number, patch: Partial<SimInputs["plans"][number]>) => setI((x) => ({ ...x, plans: x.plans.map((p, j) => (j === idx ? { ...p, ...patch } : p)) }));
  const [state, action, pending] = useActionState(save ?? (async () => undefined), undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, state?.nonce, router]);

  const money = (p: number) => formatRupees(p);
  const delta = (a: number, b: number) => {
    const d = a - b;
    return <span className={cx("tabular-nums", d > 0 ? "text-ok" : d < 0 ? "text-alert" : "text-muted")}>{d >= 0 ? "+" : "−"}{money(Math.abs(d)).replace("−", "")}</span>;
  };

  return (
    <div className={cx("grid gap-6", !compact && "lg:grid-cols-[minmax(0,420px)_1fr]")}>
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-[17px] font-semibold">Assumptions</h2>
        <p className="m-0 text-[12px] text-muted">Prices and costs in rupees a month unless said. Change anything: the forecast on the right updates at once.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Forecast months">
            <Input type="number" min={1} max={36} value={i.months} onChange={(e) => set("months", num(e.target.value))} />
          </Field>
          <Field label="Starts in month">
            <Select value={i.startMonth} onChange={(e) => set("startMonth", num(e.target.value))}>
              {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, k) => (
                <option key={m} value={k + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg/70">Membership mix (price per cycle, {i.pricesIncludeGst ? "incl. GST" : "before GST"})</span>
            <Button type="button" variant="ghost" onClick={() => set("plans", [...i.plans, { name: `Plan ${i.plans.length + 1}`, members: 0, price: 0, months: 1, discountPct: 0 }])}>
              + Plan
            </Button>
          </div>
          {i.plans.map((p, idx) => (
            <div key={idx} className="grid grid-cols-[1.4fr_0.8fr_1fr_0.7fr_0.8fr_auto] items-end gap-1.5">
              <Field label={idx === 0 ? "Plan" : ""}>
                <Input value={p.name} onChange={(e) => setPlan(idx, { name: e.target.value })} aria-label="Plan name" />
              </Field>
              <Field label={idx === 0 ? "Members" : ""}>
                <Input type="number" min={0} value={p.members} onChange={(e) => setPlan(idx, { members: num(e.target.value) })} aria-label="Members" />
              </Field>
              <Field label={idx === 0 ? "Price ₹" : ""}>
                <Input type="number" min={0} step="0.01" value={rupeesIn(p.price)} onChange={(e) => setPlan(idx, { price: toPaise(e.target.value) })} aria-label="Price in rupees" />
              </Field>
              <Field label={idx === 0 ? "Months" : ""}>
                <Input type="number" min={1} max={36} value={p.months} onChange={(e) => setPlan(idx, { months: num(e.target.value) })} aria-label="Cycle months" />
              </Field>
              <Field label={idx === 0 ? "Disc. %" : ""}>
                <Input type="number" min={0} max={100} value={p.discountPct} onChange={(e) => setPlan(idx, { discountPct: num(e.target.value) })} aria-label="Discount percent" />
              </Field>
              <Button type="button" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => set("plans", i.plans.filter((_, j) => j !== idx))}>
                ×
              </Button>
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={i.pricesIncludeGst} onChange={(e) => set("pricesIncludeGst", e.target.checked)} /> Prices include GST
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GST rate %">
            <Input type="number" min={0} max={40} value={i.gstRatePct} onChange={(e) => set("gstRatePct", num(e.target.value))} />
          </Field>
          <Field label="New members a month">
            <Input type="number" min={0} value={i.newMembersPerMonth} onChange={(e) => set("newMembersPerMonth", num(e.target.value))} />
          </Field>
          <Field label="Monthly churn %" hint="Members leaving each month, of active">
            <Input type="number" min={0} max={100} step="0.1" value={i.monthlyChurnPct} onChange={(e) => set("monthlyChurnPct", num(e.target.value))} />
          </Field>
          <Field label="Other income ₹ a month" hint="POS, personal training, before GST">
            <Input type="number" min={0} step="0.01" value={rupeesIn(i.otherIncomeMonthly)} onChange={(e) => set("otherIncomeMonthly", toPaise(e.target.value))} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs text-fg/70">Fixed costs ₹ a month</span>
          <div className="grid grid-cols-2 gap-2">
            {FIXED_KEYS.map((k) => (
              <Field key={k} label={FIXED_LABELS[k]}>
                <Input type="number" min={0} step="0.01" value={rupeesIn(i.fixed[k])} onChange={(e) => setFixed(k, toPaise(e.target.value))} />
              </Field>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Variable cost per member ₹" hint="Serving one member for a month">
            <Input type="number" min={0} step="0.01" value={rupeesIn(i.variablePerMember)} onChange={(e) => set("variablePerMember", toPaise(e.target.value))} />
          </Field>
          <Field label="Payment fees %" hint="Of collections">
            <Input type="number" min={0} max={20} step="0.1" value={i.paymentFeePct} onChange={(e) => set("paymentFeePct", num(e.target.value))} />
          </Field>
          <Field label="Refunds %" hint="Of revenue">
            <Input type="number" min={0} max={50} step="0.1" value={i.refundPct} onChange={(e) => set("refundPct", num(e.target.value))} />
          </Field>
          <Field label="Income tax %" hint="0 leaves tax out">
            <Input type="number" min={0} max={60} step="0.1" value={i.taxPct} onChange={(e) => set("taxPct", num(e.target.value))} />
          </Field>
          <Field label="Target profit ₹ a month" hint="For the minimum fee" className="col-span-2">
            <Input type="number" step="0.01" value={rupeesIn(i.targetProfitMonthly)} onChange={(e) => set("targetProfitMonthly", toPaise(e.target.value))} />
          </Field>
        </div>
        <details>
          <summary className="cursor-pointer text-xs text-fg/70">Seasonality (1 = ordinary month)</summary>
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, k) => (
              <Field key={m} label={m}>
                <Input type="number" min={0} max={5} step="0.05" value={i.seasonality[k]} onChange={(e) => set("seasonality", i.seasonality.map((s, j) => (j === k ? num(e.target.value) : s)))} />
              </Field>
            ))}
          </div>
        </details>
        {!check.ok && <Notice tone="alert">{check.error}</Notice>}
        {save && (
          <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
            <input type="hidden" name="inputs" value={JSON.stringify(i)} />
            <Field label="Scenario name" error={state?.errors?.name}>
              <Input name="name" defaultValue={name} required maxLength={120} />
            </Field>
            <Field label="Notes" error={state?.errors?.note}>
              <Input name="note" defaultValue={note} maxLength={2000} placeholder="What this tries, and why" />
            </Field>
            {extra}
            {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
            <div>
              <Button variant="primary" disabled={pending || !check.ok}>
                {pending ? "Saving…" : saveLabel}
              </Button>
            </div>
          </form>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-5">
        <Results r={result} base={base} />
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-2 text-[15px] font-semibold">Conservative, baseline and optimistic</h3>
          <p className="m-0 mb-3 text-[12px] text-muted">Joiners ±20%, churn ±2 points, costs ±5%; prices as entered. Forecasts, not promises.</p>
          <ScrollRegion label="Scenario variants">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Variant</th>
                  <th className={cx(TH, "text-right")}>Revenue</th>
                  <th className={cx(TH, "text-right")}>Operating expenses</th>
                  <th className={cx(TH, "text-right")}>Operating profit</th>
                  <th className={cx(TH, "text-right")}>Margin</th>
                  <th className={cx(TH, "text-right")}>Members at end</th>
                </tr>
              </thead>
              <tbody>
                {(["conservative", "baseline", "optimistic"] as const).map((k) => (
                  <tr key={k} className={TR}>
                    <td className={TD}>{SCENARIO_LABEL[k]}</td>
                    <td className={cx(TD, "text-right tabular-nums")}>{money(three[k].totals.revenue + three[k].totals.otherIncome - three[k].totals.refunds)}</td>
                    <td className={cx(TD, "text-right tabular-nums")}>{money(three[k].totals.operatingExpenses)}</td>
                    <td className={cx(TD, "text-right font-semibold tabular-nums")}>{money(three[k].totals.operatingProfit)}</td>
                    <td className={cx(TD, "text-right tabular-nums")}>{three[k].operatingMarginPct === null ? "—" : `${three[k].operatingMarginPct}%`}</td>
                    <td className={cx(TD, "text-right tabular-nums")}>{three[k].totals.activeEnd}</td>
                  </tr>
                ))}
                <tr className={TR}>
                  <td className={cx(TD, "text-muted")}>As the books stand (baseline inputs)</td>
                  <td className={cx(TD, "text-right tabular-nums text-muted")}>{money(base.totals.revenue + base.totals.otherIncome - base.totals.refunds)}</td>
                  <td className={cx(TD, "text-right tabular-nums text-muted")}>{money(base.totals.operatingExpenses)}</td>
                  <td className={cx(TD, "text-right tabular-nums text-muted")}>{money(base.totals.operatingProfit)}</td>
                  <td className={cx(TD, "text-right tabular-nums text-muted")}>{base.operatingMarginPct === null ? "—" : `${base.operatingMarginPct}%`}</td>
                  <td className={cx(TD, "text-right tabular-nums text-muted")}>{base.totals.activeEnd}</td>
                </tr>
              </tbody>
            </table>
          </ScrollRegion>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-2 text-[15px] font-semibold">Sensitivity</h3>
          <p className="m-0 mb-3 text-[12px] text-muted">What each assumption, changed on its own, does to the operating profit over {i.months} months.</p>
          <ScrollRegion label="Sensitivity">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Assumption</th>
                  <th className={TH}>Change</th>
                  <th className={cx(TH, "text-right")}>Operating profit</th>
                  <th className={cx(TH, "text-right")}>Against this scenario</th>
                </tr>
              </thead>
              <tbody>
                {sens.map((s) => (
                  <tr key={`${s.label}${s.change}`} className={TR}>
                    <td className={TD}>{s.label}</td>
                    <td className={TD}>{s.change}</td>
                    <td className={cx(TD, "text-right tabular-nums")}>{money(s.operatingProfit)}</td>
                    <td className={cx(TD, "text-right")}>{delta(s.operatingProfit, result.totals.operatingProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-2 text-[15px] font-semibold">Month by month</h3>
          <ScrollRegion label="Monthly forecast" className="max-h-[420px]">
            <table className={TABLE}>
              <thead className="sticky top-0 bg-surface">
                <tr>
                  <th className={TH}>Month</th>
                  <th className={cx(TH, "text-right")}>Members</th>
                  <th className={cx(TH, "text-right")}>Revenue</th>
                  <th className={cx(TH, "text-right")}>GST (apart)</th>
                  <th className={cx(TH, "text-right")}>Expenses</th>
                  <th className={cx(TH, "text-right")}>Operating profit</th>
                  <th className={cx(TH, "text-right")}>Net cash</th>
                </tr>
              </thead>
              <tbody>
                {result.months.map((m) => (
                  <tr key={m.index} className={TR}>
                    <td className={TD}>{m.index}</td>
                    <td className={cx(TD, "text-right tabular-nums")}>{m.activeEnd}</td>
                    <td className={cx(TD, "text-right tabular-nums")}>{money(m.revenue + m.otherIncome - m.refunds)}</td>
                    <td className={cx(TD, "text-right tabular-nums text-muted")}>{money(m.gst)}</td>
                    <td className={cx(TD, "text-right tabular-nums")}>{money(m.operatingExpenses)}</td>
                    <td className={cx(TD, "text-right tabular-nums", m.operatingProfit < 0 && "text-alert")}>{money(m.operatingProfit)}</td>
                    <td className={cx(TD, "text-right tabular-nums", m.netCash < 0 && "text-alert")}>{money(m.netCash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </div>
      </section>
    </div>
  );
}

function Results({ r, base }: { r: SimResult; base: SimResult }) {
  const money = (p: number) => formatRupees(p);
  const tile = (label: string, value: string, sub?: string, tone?: "alert" | "ok") => (
    <div className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface px-4 py-3">
      <span className="text-[11px] tracking-[0.08em] text-muted uppercase">{label}</span>
      <span className={cx("text-[24px] leading-none font-semibold tabular-nums", tone === "alert" && "text-alert", tone === "ok" && "text-ok")}>{value}</span>
      {sub && <span className="text-[12px] text-muted">{sub}</span>}
    </div>
  );
  const income = r.totals.revenue + r.totals.otherIncome - r.totals.refunds;
  const d = r.totals.operatingProfit - base.totals.operatingProfit;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
      {tile("Projected revenue", money(income), `${r.months.length} months, before GST`)}
      {tile("Projected operating expenses", money(r.totals.operatingExpenses))}
      {tile("Estimated operating profit", money(r.totals.operatingProfit), `${d >= 0 ? "+" : "−"}${money(Math.abs(d))} against the books as they stand`, r.totals.operatingProfit < 0 ? "alert" : undefined)}
      {tile("Operating margin", r.operatingMarginPct === null ? "—" : `${r.operatingMarginPct}%`)}
      {tile("Break-even members", r.breakEvenMembers === null ? "—" : r.breakEvenMembers.toLocaleString("en-IN"), r.breakEvenRevenue === null ? "Contribution per member is not positive" : `${money(r.breakEvenRevenue)} a month`)}
      {tile("Contribution per member", money(r.contributionPerMember), "A month, after variable cost and fees", r.contributionPerMember <= 0 ? "alert" : undefined)}
      {tile("Minimum fee for target", r.minFeeForTarget === null ? "—" : money(r.minFeeForTarget), r.minPriceByPlan.length ? r.minPriceByPlan.map((p) => `${p.name} ${money(p.price)}`).join(" · ") : "A month per member, before GST")}
      {tile("Net cash over the period", money(r.totals.netCash), "Collections incl. GST, less costs, tax and GST paid over", r.totals.netCash < 0 ? "alert" : "ok")}
    </div>
  );
}
