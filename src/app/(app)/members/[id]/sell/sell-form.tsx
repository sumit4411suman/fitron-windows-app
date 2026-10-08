"use client";

import { useActionState, useState } from "react";
import { sell } from "../../../billing-actions";
import { Button, Card, Field, Input, LinkButton, Notice, Select } from "@/components/ui";
import { invoiceTotals } from "@/lib/domain/billing";
import { membershipEndDate } from "@/lib/domain/dates";
import { formatInr, fmtDate } from "@/lib/format";
import { METHODS } from "@/lib/validation/billing";

type Plan = { id: string; name: string; months: number; price: number; regFee: number; gstApplicable: boolean; prices: { category: string; price: number }[] };

const toPaise = (s: string) => {
  const n = Number(s.replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function SellForm({
  memberId,
  plans,
  defaultPlanId,
  defaultStart,
  isNew,
  taxRate,
}: {
  memberId: string;
  plans: Plan[];
  defaultPlanId?: string;
  defaultStart: string;
  isNew: boolean;
  taxRate: number;
}) {
  const [state, action, pending] = useActionState(sell.bind(null, memberId), undefined);
  const sent = state?.values as Record<string, string> | undefined;
  const [planId, setPlanId] = useState(sent?.planId ?? defaultPlanId ?? plans[0]?.id ?? "");
  const [start, setStart] = useState(sent?.startDate ?? defaultStart);
  const [discount, setDiscount] = useState(sent?.discount ?? "");
  const [category, setCategory] = useState(sent?.pricingCategory ?? "Standard");
  const [regFee, setRegFee] = useState(sent ? sent.includeRegFee === "on" : isNew);
  const [pay, setPay] = useState<string | null>(sent?.payAmount ?? null);
  const e = state?.errors ?? {};

  const plan = plans.find((p) => p.id === planId);
  const rate = plan?.gstApplicable ? taxRate : 0;
  const price = plan?.prices.find((x) => x.category === category)?.price ?? plan?.price ?? 0;
  const lines = plan
    ? [
        { qty: 1, rate: price, discount: toPaise(discount), taxRate: rate },
        ...(regFee && plan.regFee > 0 ? [{ qty: 1, rate: plan.regFee, discount: 0, taxRate: rate }] : []),
      ]
    : [];
  const t = invoiceTotals(lines);
  const payValue = pay ?? String(t.total / 100);

  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <Card title="Plan">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan" error={e.planId}>
            <Select
              name="planId"
              value={planId}
              onChange={(ev) => {
                setPlanId(ev.target.value);
                setCategory("Standard");
              }}
              required
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatInr(p.price)}
                </option>
              ))}
            </Select>
          </Field>
          {plan && plan.prices.length > 0 && (
            <Field label="Pricing" error={e.pricingCategory}>
              <Select name="pricingCategory" value={category} onChange={(ev) => setCategory(ev.target.value)}>
                <option value="Standard">Standard · {formatInr(plan.price)}</option>
                {plan.prices.map((x) => (
                  <option key={x.category} value={x.category}>
                    {x.category} · {formatInr(x.price)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Start date" error={e.startDate} hint={plan ? `Ends ${fmtDate(membershipEndDate(start, plan.months))}` : undefined}>
            <Input name="startDate" type="date" value={start} onChange={(ev) => setStart(ev.target.value)} required />
          </Field>
          <Field label="Discount (₹)" error={e.discount}>
            <Input name="discount" inputMode="decimal" value={discount} onChange={(ev) => setDiscount(ev.target.value)} placeholder="0" />
          </Field>
          <Field label="Offer code" error={e.offerCode} hint="Its discount is added when you save">
            <Input name="offerCode" defaultValue={(sent?.offerCode as string | undefined) ?? ""} className="[&:not(:placeholder-shown)]:uppercase" placeholder="Optional" />
          </Field>
          {plan && plan.regFee > 0 && (
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" name="includeRegFee" checked={regFee} onChange={(ev) => setRegFee(ev.target.checked)} className="size-4" />
              Add registration fee ({formatInr(plan.regFee)})
            </label>
          )}
        </div>
      </Card>
      <Card title="Invoice">
        <dl className="grid max-w-sm grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-right">{formatInr(t.subtotal)}</dd>
          <dt className="text-muted">Discount</dt>
          <dd className="text-right">− {formatInr(t.discount)}</dd>
          <dt className="text-muted">GST {rate ? `(${rate}%)` : ""}</dt>
          <dd className="text-right">{formatInr(t.tax)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right text-lg font-semibold">{formatInr(t.total)}</dd>
        </dl>
      </Card>
      <Card title="Collect now">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Amount received now (₹)" error={e.payAmount} hint="Enter 0 to invoice without collecting">
            <Input name="payAmount" inputMode="decimal" value={payValue} onChange={(ev) => setPay(ev.target.value)} />
          </Field>
          <Field label="Method" error={e.payMethod}>
            <Select name="payMethod" defaultValue={sent?.payMethod ?? "UPI"}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" error={e.payRef} hint="UPI ref or card slip no.">
            <Input name="payRef" defaultValue={sent?.payRef} />
          </Field>
        </div>
      </Card>
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending || !plan}>
          {pending ? "Saving…" : isNew ? "Create membership" : "Renew and generate invoice"}
        </Button>
        <LinkButton href={`/members/${memberId}`}>Cancel</LinkButton>
      </div>
    </form>
  );
}
