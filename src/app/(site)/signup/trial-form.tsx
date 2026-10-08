"use client";

import { useActionState, useState } from "react";
import { requestTrial } from "../actions";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { PLANS, PRODUCT_LABEL, findPlan, rupeesLabel, type Cycle, type Product } from "@/lib/domain/pricing";

// Gym plans have their own sign-up form, so this one offers the rest.
const groups: Product[] = ["AI_TRAINER", "PARTNER"];

export function TrialForm({ plan: initialPlan, cycle: initialCycle }: { plan: string; cycle: Cycle }) {
  const [state, action, pending] = useActionState(requestTrial, undefined);
  const sent = state?.ok ? undefined : state?.values;
  const [plan, setPlan] = useState((sent?.plan as string) ?? initialPlan);
  const [cycle, setCycle] = useState<Cycle>(((sent?.cycle as Cycle) ?? initialCycle) === "YEARLY" ? "YEARLY" : "MONTHLY");
  const e = state?.errors ?? {};
  const v = (k: string) => sent?.[k] as string | undefined;
  const p = findPlan(plan)!;
  const forGym = p.product !== "AI_TRAINER";

  if (state?.ok) return <Notice tone="ok">{state.message}</Notice>;
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4" noValidate>
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <Field label="Plan" error={e.plan}>
        <Select name="plan" value={plan} onChange={(ev) => setPlan(ev.target.value)} required>
          {groups.map((g) => (
            <optgroup key={g} label={PRODUCT_LABEL[g]}>
              {PLANS.filter((x) => x.product === g).map((x) => (
                <option key={x.key} value={x.key}>
                  {x.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="mb-1.5 font-semibold">Billing</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["MONTHLY", "YEARLY"] as const).map((c) => (
            <label key={c} className={`flex cursor-pointer flex-col rounded-md border px-3 py-2 ${cycle === c ? "border-accent bg-accent-soft" : "border-line"}`}>
              <span className="flex items-center gap-2 font-semibold">
                <input type="radio" name="cycle" value={c} checked={cycle === c} onChange={() => setCycle(c)} className="accent-[var(--color-accent)]" />
                {c === "MONTHLY" ? "Monthly" : "Yearly"}
              </span>
              <span className="text-muted">
                {rupeesLabel(p.price[c])} / {c === "MONTHLY" ? "month" : "year"}
              </span>
            </label>
          ))}
        </div>
        {e.cycle?.map((m) => <span key={m} className="text-xs text-alert">{m}</span>)}
      </fieldset>
      <Field label="Your name" error={e.name}>
        <Input name="name" autoComplete="name" defaultValue={v("name")} required />
      </Field>
      <Field label="Email" error={e.email}>
        <Input name="email" type="email" autoComplete="email" defaultValue={v("email")} required />
      </Field>
      <Field label="Mobile (optional)" error={e.phone} hint="10 digits. We use it for WhatsApp updates about your account.">
        <Input name="phone" type="tel" inputMode="tel" autoComplete="tel-national" defaultValue={v("phone")} />
      </Field>
      {forGym && (
        <Field label="Gym name" error={e.business}>
          <Input name="business" autoComplete="organization" defaultValue={v("business")} required />
        </Field>
      )}
      <Field label="City (optional)" error={e.city}>
        <Input name="city" autoComplete="address-level2" defaultValue={v("city")} />
      </Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      <Button variant="primary" disabled={pending} className="mt-2 min-h-12">
        {pending ? "Sending…" : p.trialDays ? `Start my ${p.trialDays}-day free trial` : "Request partnership"}
      </Button>
      <p className="text-xs text-muted">
        By continuing you agree to our <a href="/terms" className="underline">Terms</a> and <a href="/privacy" className="underline">Privacy Policy</a>. Prices include 18% GST.
      </p>
    </form>
  );
}
