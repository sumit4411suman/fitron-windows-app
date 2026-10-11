"use client";

import { useActionState, useState } from "react";
import { ReasonForm } from "@/components/reason-form";
import { cancel, collect, reverse } from "../../billing-actions";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { METHODS } from "@/lib/validation/billing";

export function CollectForm({ invoiceId, balance, today }: { invoiceId: string; balance: number; today: string }) {
  const [state, action, pending] = useActionState(collect.bind(null, invoiceId), undefined);
  // ₹0 (or less) is answered here at once; nothing is sent to the server for it.
  const [zero, setZero] = useState(false);
  const e = state?.errors ?? {};
  const sent = state?.ok ? undefined : (state?.values as Record<string, string> | undefined);
  return (
    <form
      action={action}
      key={`${state?.nonce}-${balance}`}
      onSubmit={(ev) => {
        const n = Number(String(new FormData(ev.currentTarget).get("amount") ?? "").replace(/[₹,\s]/g, ""));
        const bad = Number.isFinite(n) && n <= 0;
        setZero(bad);
        if (bad) ev.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      {state?.message && !zero && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      {zero && <Notice tone="alert">Enter an amount more than ₹0.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)" error={zero ? ["Enter an amount more than ₹0."] : e.amount}>
          <Input name="amount" inputMode="decimal" defaultValue={sent?.amount ?? String(balance / 100)} required />
        </Field>
        <Field label="Method" error={e.method}>
          <Select name="method" defaultValue={sent?.method ?? "UPI"}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date" error={e.date}>
          <Input name="date" type="date" defaultValue={sent?.date ?? today} max={today} required />
        </Field>
        <Field label="Reference" error={e.txnRef}>
          <Input name="txnRef" defaultValue={sent?.txnRef} />
        </Field>
      </div>
      <div>
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}

export function CancelInvoice({ invoiceId }: { invoiceId: string }) {
  return (
    <ReasonForm
      action={cancel.bind(null, invoiceId) as never}
      label="Cancel invoice"
      confirm="Cancel this invoice? Its payments will be reversed and any membership on it cancelled."
    />
  );
}

export function ReversePayment({ paymentId, invoiceId, compact }: { paymentId: string; invoiceId: string; compact?: boolean }) {
  return <ReasonForm action={reverse.bind(null, paymentId, invoiceId) as never} label="Reverse" confirm="Reverse this payment?" compact={compact} />;
}
