"use client";

import { useState } from "react";
import {
  ACTIVITY, CALORIE_GOALS, PROTEIN_GOALS, breakEven, calories, checkBreakEven, checkCalories, checkChurn, checkGst, checkPricing, checkProfit, checkProtein, checkRevenue, churn, gstOnMembership, gymPricing, gymProfit,
  membershipRevenue, proteinTarget, type Activity, type CalorieGoal, type ProteinGoal,
} from "@/lib/domain/calculators";
import { Check, Choice, NumField, Result, Row, inr, num } from "./fields";

// One component per calculator. The numbers shown first are examples; the maths is in src/lib/domain/calculators.ts.

const grid = "grid items-end gap-4 sm:grid-cols-2";
const pct = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

function Layout({ inputs, result }: { inputs: React.ReactNode; result: React.ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <form className="s-card p-5" onSubmit={(e) => e.preventDefault()} aria-label="Your numbers">
        <p className="mb-4 text-sm text-muted">Example numbers are filled in. Change them to yours.</p>
        <div className={grid}>{inputs}</div>
      </form>
      <div className="lg:sticky lg:top-24 lg:self-start">{result}</div>
    </div>
  );
}

function GymProfit() {
  const [s, set] = useState({ members: "220", avgFee: "1200", otherIncome: "15000", rent: "60000", salaries: "90000", utilities: "20000", marketing: "10000", maintenance: "8000", other: "5000" });
  const [includesGst, setIncl] = useState(true);
  const [rate, setRate] = useState("18");
  const f = (k: keyof typeof s) => (v: string) => set({ ...s, [k]: v });
  const input = { members: num(s.members), avgFee: num(s.avgFee), otherIncome: num(s.otherIncome), includesGst, gstRatePct: num(rate), rent: num(s.rent), salaries: num(s.salaries), utilities: num(s.utilities), marketing: num(s.marketing), maintenance: num(s.maintenance), other: num(s.other) };
  const c = checkProfit(input);
  const r = c.ok ? gymProfit(input) : null;
  return (
    <Layout
      inputs={
        <>
          <NumField label="Active members" value={s.members} onChange={f("members")} step="1" />
          <NumField label="Average fee per member, per month" value={s.avgFee} onChange={f("avgFee")} unit="₹" />
          <NumField label="Other income per month" value={s.otherIncome} onChange={f("otherIncome")} unit="₹" help="Personal training, supplements, locker rent" />
          <div className="flex flex-col justify-end">
            <Check label="Fees and other income include GST" checked={includesGst} onChange={setIncl} />
            {includesGst && <NumField label="GST rate" value={rate} onChange={setRate} unit="%" />}
          </div>
          <NumField label="Rent" value={s.rent} onChange={f("rent")} unit="₹ / month" />
          <NumField label="Salaries" value={s.salaries} onChange={f("salaries")} unit="₹ / month" />
          <NumField label="Electricity, water, internet" value={s.utilities} onChange={f("utilities")} unit="₹ / month" />
          <NumField label="Marketing" value={s.marketing} onChange={f("marketing")} unit="₹ / month" />
          <NumField label="Equipment upkeep" value={s.maintenance} onChange={f("maintenance")} unit="₹ / month" />
          <NumField label="Other costs" value={s.other} onChange={f("other")} unit="₹ / month" />
        </>
      }
      result={
        <Result error={c.ok ? null : c.error}>
          {r && (
            <dl>
              <Row k="Revenue (without GST)" v={inr(r.revenue)} />
              <Row k="Costs" v={inr(r.expenses)} />
              <Row k="Monthly profit" v={r.profit < 0 ? `−${inr(-r.profit)}` : inr(r.profit)} strong />
              <Row k="Margin" v={pct(r.marginPct)} />
              <Row k="Profit per member" v={r.profitPerMember < 0 ? `−${inr(-r.profitPerMember)}` : inr(r.profitPerMember)} />
              <Row k="Members to break even" v={r.breakEvenMembers === null ? "Needs a fee above 0" : r.breakEvenMembers.toLocaleString("en-IN")} />
            </dl>
          )}
        </Result>
      }
    />
  );
}

function MembershipRevenue() {
  const [rows, setRows] = useState([
    { name: "Monthly", members: "70", price: "1500", months: "1" },
    { name: "Quarterly", members: "50", price: "4000", months: "3" },
    { name: "Half-yearly", members: "30", price: "7000", months: "6" },
    { name: "Annual", members: "30", price: "12000", months: "12" },
  ]);
  const plans = rows.map((p) => ({ name: p.name, members: num(p.members), price: num(p.price), months: num(p.months) }));
  const c = checkRevenue(plans);
  const r = c.ok ? membershipRevenue(plans) : null;
  const edit = (i: number, k: "members" | "price" | "months") => (v: string) => setRows(rows.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <Layout
      inputs={rows.map((p, i) => (
        <fieldset key={p.name} className="s-card grid gap-3 p-4 sm:col-span-2 sm:grid-cols-3">
          <legend className="px-1 text-sm font-bold">{p.name} plan</legend>
          <NumField label="Members" value={p.members} onChange={edit(i, "members")} step="1" />
          <NumField label="Price" value={p.price} onChange={edit(i, "price")} unit="₹" />
          <NumField label="Months covered" value={p.months} onChange={edit(i, "months")} step="1" />
        </fieldset>
      ))}
      result={
        <Result error={c.ok ? null : c.error}>
          {r && (
            <dl>
              <Row k="Monthly revenue" v={inr(r.monthly)} strong />
              <Row k="Yearly revenue" v={inr(r.yearly)} />
              <Row k="Members" v={r.membersTotal.toLocaleString("en-IN")} />
              <Row k="Cash collected if all pay once" v={inr(r.cashPerCycle)} />
              {r.lines.map((l) => (
                <Row key={l.name} k={`${l.name}: share`} v={`${inr(l.monthly)} · ${pct(l.sharePct)}`} />
              ))}
            </dl>
          )}
        </Result>
      }
    />
  );
}

function BreakEven() {
  const [s, set] = useState({ fixedCosts: "180000", feePerMember: "1100", costPerMember: "60", currentMembers: "200", setupInvestment: "1200000" });
  const f = (k: keyof typeof s) => (v: string) => set({ ...s, [k]: v });
  const input = { fixedCosts: num(s.fixedCosts), feePerMember: num(s.feePerMember), costPerMember: num(s.costPerMember), currentMembers: num(s.currentMembers), setupInvestment: num(s.setupInvestment) };
  const c = checkBreakEven(input);
  const r = c.ok ? breakEven(input) : null;
  return (
    <Layout
      inputs={
        <>
          <NumField label="Fixed costs" value={s.fixedCosts} onChange={f("fixedCosts")} unit="₹ / month" help="Rent, salaries, loan repayments, insurance" />
          <NumField label="Fee per member, without GST" value={s.feePerMember} onChange={f("feePerMember")} unit="₹ / month" />
          <NumField label="Cost to serve one member" value={s.costPerMember} onChange={f("costPerMember")} unit="₹ / month" help="Costs that rise with each member" />
          <NumField label="Members you have now" value={s.currentMembers} onChange={f("currentMembers")} step="1" />
          <NumField label="Set-up investment" value={s.setupInvestment} onChange={f("setupInvestment")} unit="₹" help="Equipment, fit-out and deposits. 0 if none" />
        </>
      }
      result={
        <Result error={c.ok ? null : c.error}>
          {r && (
            <dl>
              <Row k="Members needed to break even" v={r.membersNeeded === null ? "None: each member costs more than they pay" : r.membersNeeded.toLocaleString("en-IN")} strong />
              <Row k="Left from each member" v={r.contribution < 0 ? `−${inr(-r.contribution)}` : inr(r.contribution)} />
              <Row k="Revenue needed per month" v={r.revenueNeeded === null ? "—" : inr(r.revenueNeeded)} />
              <Row k="Monthly profit with your members now" v={r.monthlyProfit < 0 ? `−${inr(-r.monthlyProfit)}` : inr(r.monthlyProfit)} />
              <Row k="Months to earn back the set-up" v={r.paybackMonths === null ? "—" : r.paybackMonths.toLocaleString("en-IN")} />
            </dl>
          )}
        </Result>
      }
    />
  );
}

function Gst() {
  const [amount, setAmount] = useState("5000");
  const [inclusive, setIncl] = useState<"yes" | "no">("no");
  const [rate, setRate] = useState("18");
  const [supply, setSupply] = useState<"same-state" | "other-state">("same-state");
  const input = { amount: num(amount), inclusive: inclusive === "yes", ratePct: num(rate), supply };
  const c = checkGst(input);
  const r = c.ok ? gstOnMembership(input) : null;
  return (
    <Layout
      inputs={
        <>
          <NumField label="Membership price" value={amount} onChange={setAmount} unit="₹" />
          <Choice label="Does this price include GST?" value={inclusive} onChange={setIncl} options={[["no", "No, add GST to it"], ["yes", "Yes, take GST out of it"]]} />
          <NumField label="GST rate" value={rate} onChange={setRate} unit="%" help="18% is the rate commonly applied to gym services" />
          <Choice label="Where is the member?" value={supply} onChange={setSupply} options={[["same-state", "Same state as the gym"], ["other-state", "Another state"]]} />
        </>
      }
      result={
        <Result error={c.ok ? null : c.error}>
          {r && (
            <dl>
              <Row k="Price before GST" v={inr(r.base, 2)} />
              {supply === "same-state" ? (
                <>
                  <Row k={`CGST (${Number(rate) / 2}%)`} v={inr(r.cgst, 2)} />
                  <Row k={`SGST (${Number(rate) / 2}%)`} v={inr(r.sgst, 2)} />
                </>
              ) : (
                <Row k={`IGST (${Number(rate)}%)`} v={inr(r.igst, 2)} />
              )}
              <Row k="Total GST" v={inr(r.tax, 2)} />
              <Row k="Total to pay" v={inr(r.total, 2)} strong />
            </dl>
          )}
        </Result>
      }
    />
  );
}

function Churn() {
  const [s, set] = useState({ start: "200", lost: "18", joined: "25", months: "1", avgFee: "1200" });
  const f = (k: keyof typeof s) => (v: string) => set({ ...s, [k]: v });
  const input = { start: num(s.start), lost: num(s.lost), joined: num(s.joined), months: num(s.months), avgFee: num(s.avgFee) };
  const c = checkChurn(input);
  const r = c.ok ? churn(input) : null;
  return (
    <Layout
      inputs={
        <>
          <NumField label="Members at the start" value={s.start} onChange={f("start")} step="1" />
          <NumField label="Members lost" value={s.lost} onChange={f("lost")} step="1" help="Expired and not renewed, or cancelled" />
          <NumField label="New members joined" value={s.joined} onChange={f("joined")} step="1" />
          <NumField label="Length of the period" value={s.months} onChange={f("months")} unit="months" step="1" />
          <NumField label="Average fee per member, per month" value={s.avgFee} onChange={f("avgFee")} unit="₹" />
        </>
      }
      result={
        <Result error={c.ok ? null : c.error}>
          {r && (
            <dl>
              <Row k="Churn for the period" v={pct(r.periodChurnPct)} strong />
              <Row k="Retention" v={pct(r.retentionPct)} />
              <Row k="Churn per month" v={pct(r.monthlyChurnPct)} />
              <Row k="Average time a member stays" v={r.lifetimeMonths === null ? "No one left" : `${r.lifetimeMonths.toLocaleString("en-IN")} months`} />
              <Row k="Members at the end" v={r.end.toLocaleString("en-IN")} />
              <Row k="Monthly revenue lost" v={inr(r.revenueLostMonthly)} />
            </dl>
          )}
        </Result>
      }
    />
  );
}

function Pricing() {
  const [s, set] = useState({ monthlyCosts: "190000", targetProfit: "50000", members: "200", gstRatePct: "18", discount3: "5", discount6: "10", discount12: "15" });
  const f = (k: keyof typeof s) => (v: string) => set({ ...s, [k]: v });
  const input = { monthlyCosts: num(s.monthlyCosts), targetProfit: num(s.targetProfit), members: num(s.members), gstRatePct: num(s.gstRatePct), discount3: num(s.discount3), discount6: num(s.discount6), discount12: num(s.discount12) };
  const c = checkPricing(input);
  const r = c.ok ? gymPricing(input) : null;
  return (
    <Layout
      inputs={
        <>
          <NumField label="Monthly costs" value={s.monthlyCosts} onChange={f("monthlyCosts")} unit="₹" help="Everything the gym costs to run each month" />
          <NumField label="Profit you want each month" value={s.targetProfit} onChange={f("targetProfit")} unit="₹" />
          <NumField label="Members you expect to keep" value={s.members} onChange={f("members")} step="1" />
          <NumField label="GST rate" value={s.gstRatePct} onChange={f("gstRatePct")} unit="%" />
          <NumField label="Discount on a 3-month plan" value={s.discount3} onChange={f("discount3")} unit="%" />
          <NumField label="Discount on a 6-month plan" value={s.discount6} onChange={f("discount6")} unit="%" />
          <NumField label="Discount on a 12-month plan" value={s.discount12} onChange={f("discount12")} unit="%" />
        </>
      }
      result={
        <Result error={c.ok ? null : c.error}>
          {r && (
            <dl>
              <Row k="Monthly fee needed, without GST" v={inr(r.feeExGst, 2)} strong />
              <Row k="Monthly fee with GST" v={inr(r.feeWithGst, 2)} />
              {r.plans.map((p) => (
                <Row key={p.months} k={`${p.months}-month plan${p.discountPct ? ` (${p.discountPct}% off)` : ""}`} v={`${inr(p.priceWithGst)} · ${inr(p.perMonthWithGst)}/mo`} />
              ))}
            </dl>
          )}
        </Result>
      }
    />
  );
}

function Protein() {
  const [weight, setWeight] = useState("70");
  const [goal, setGoal] = useState<ProteinGoal>("muscle");
  const [meals, setMeals] = useState("4");
  const w = num(weight);
  const m = num(meals);
  const c = checkProtein(w);
  const mealsOk = Number.isInteger(m) && m >= 1 && m <= 8;
  const r = c.ok && mealsOk ? proteinTarget(w, goal, m) : null;
  return (
    <Layout
      inputs={
        <>
          <NumField label="Your weight" value={weight} onChange={setWeight} unit="kg" />
          <Choice label="Your goal" value={goal} onChange={setGoal} options={(Object.entries(PROTEIN_GOALS) as [ProteinGoal, { label: string }][]).map(([k, v]) => [k, v.label] as const)} />
          <NumField label="Meals a day" value={meals} onChange={setMeals} step="1" help="1 to 8" />
        </>
      }
      result={
        <Result error={!c.ok ? c.error : !mealsOk ? "Meals a day should be a whole number from 1 to 8." : null}>
          {r && (
            <dl>
              <Row k="Protein a day" v={`${r.min} to ${r.max} g`} strong />
              <Row k="Per kg of body weight" v={`${r.perKgMin} to ${r.perKgMax} g`} />
              <Row k={`Per meal (${m} meals)`} v={`${r.perMealMin} to ${r.perMealMax} g`} />
            </dl>
          )}
        </Result>
      }
    />
  );
}

function Calories() {
  const [s, set] = useState({ age: "30", heightCm: "172", weightKg: "72" });
  const [sex, setSex] = useState<"male" | "female">("male");
  const [activity, setActivity] = useState<Activity>("moderate");
  const [goal, setGoal] = useState<CalorieGoal>("lose");
  const f = (k: keyof typeof s) => (v: string) => set({ ...s, [k]: v });
  const input = { sex, age: num(s.age), heightCm: num(s.heightCm), weightKg: num(s.weightKg), activity, goal };
  const c = checkCalories(input);
  const r = c.ok ? calories(input) : null;
  return (
    <Layout
      inputs={
        <>
          <Choice label="Estimate using the" value={sex} onChange={setSex} options={[["male", "Male formula"], ["female", "Female formula"]]} />
          <NumField label="Age" value={s.age} onChange={f("age")} unit="years" step="1" />
          <NumField label="Height" value={s.heightCm} onChange={f("heightCm")} unit="cm" />
          <NumField label="Weight" value={s.weightKg} onChange={f("weightKg")} unit="kg" />
          <Choice label="How active are you?" value={activity} onChange={setActivity} options={(Object.entries(ACTIVITY) as [Activity, { label: string }][]).map(([k, v]) => [k, v.label] as const)} />
          <Choice label="Your goal" value={goal} onChange={setGoal} options={(Object.entries(CALORIE_GOALS) as [CalorieGoal, { label: string }][]).map(([k, v]) => [k, v.label] as const)} />
        </>
      }
      result={
        <Result error={c.ok ? null : c.error}>
          {r && (
            <>
              <dl>
                <Row k="Daily target" v={`${r.target.toLocaleString("en-IN")} kcal`} strong />
                <Row k="To stay the same" v={`${r.maintenance.toLocaleString("en-IN")} kcal`} />
                <Row k="Resting energy" v={`${r.bmr.toLocaleString("en-IN")} kcal`} />
              </dl>
              {r.belowFloor && (
                <p role="alert" className="mt-3 rounded-md border border-alert/50 p-3 text-sm">
                  This target is below {r.floor.toLocaleString("en-IN")} kcal, which is lower than is usually advised without a doctor or dietitian. Choose a gentler goal or ask a professional.
                </p>
              )}
            </>
          )}
        </Result>
      }
    />
  );
}

const BY_SLUG: Record<string, () => React.JSX.Element> = {
  "gym-profit-calculator": GymProfit,
  "gym-membership-revenue-calculator": MembershipRevenue,
  "gym-break-even-calculator": BreakEven,
  "gst-calculator-for-gym-memberships": Gst,
  "gym-churn-calculator": Churn,
  "gym-pricing-calculator": Pricing,
  "protein-calculator": Protein,
  "calorie-calculator": Calories,
};

export function Calculator({ slug }: { slug: string }) {
  const C = BY_SLUG[slug];
  return C ? <C /> : null;
}
