"use client";

import { startTransition, useActionState, useState } from "react";
import { saveTax } from "./actions";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { gstPreview } from "@/lib/domain/tax";

type Tax = { enabled: boolean; rate: number; type: "CGST+SGST" | "IGST"; gstin?: string; sac?: string };

/** Settings › Billing & GST, with the prototype's live preview line recomputed as the fields change. */
export function TaxForm({ tax, invoicePrefix, nextNumber }: { tax: Tax; invoicePrefix: string; nextNumber: number }) {
  const [state, action, pending] = useActionState(saveTax, undefined);
  const [enabled, setEnabled] = useState(tax.enabled);
  const [rate, setRate] = useState(String(tax.rate));
  const [type, setType] = useState<Tax["type"]>(tax.type);
  const [gstin, setGstin] = useState(tax.gstin ?? "");
  const [sac, setSac] = useState(tax.sac ?? "999723");
  const [prefix, setPrefix] = useState(invoicePrefix);
  const preview = gstPreview({ enabled, rate: Number(rate) || 0, type }, prefix.toUpperCase(), nextNumber);
  const e = state?.errors ?? {};

  return (
    <form
      // Sent by hand rather than with action={…}: React resets a form after its action, which would put the GST tick
      // back to how the page first drew it while this component still remembers what the owner chose.
      onSubmit={(ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        startTransition(() => action(fd));
      }}
      className="flex flex-col gap-[22px]"
    >
      {state?.message && (
        <div role={state.ok ? "status" : "alert"}>
          <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2.5 text-[15px]">
        <input type="checkbox" name="enabled" checked={enabled} onChange={(ev) => setEnabled(ev.target.checked)} className="size-[18px] accent-accent" />
        Charge GST on invoices
      </label>
      <div className="grid gap-x-6 gap-y-[18px] sm:grid-cols-2 lg:grid-cols-3">
        <Field label="GST rate (%)" error={e.rate}>
          <Input name="rate" type="number" step="0.01" min={0} max={28} value={rate} onChange={(ev) => setRate(ev.target.value)} />
        </Field>
        <Field label="Tax type" error={e.type}>
          <Select name="type" value={type} onChange={(ev) => setType(ev.target.value as Tax["type"])}>
            <option value="CGST+SGST">CGST + SGST (intra-state)</option>
            <option value="IGST">IGST (inter-state)</option>
          </Select>
        </Field>
        <Field label="GSTIN" hint={enabled ? "Needed to charge GST. Printed on invoices under your gym's name." : "Printed on invoices under your gym's name."} error={e.gstin}>
          <Input name="gstin" value={gstin} onChange={(ev) => setGstin(ev.target.value)} placeholder="20ABCDE1234F1Z5" maxLength={15} className="uppercase" autoCapitalize="characters" />
        </Field>
        <Field label="SAC code" error={e.sac}>
          <Input name="sac" value={sac} onChange={(ev) => setSac(ev.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Invoice prefix" hint="Numbers keep counting from where they are; only the prefix changes." error={e.invoicePrefix}>
          <Input name="invoicePrefix" value={prefix} onChange={(ev) => setPrefix(ev.target.value)} maxLength={10} className="uppercase" autoCapitalize="characters" />
        </Field>
        <Field label="Currency">
          <Input value="INR (₹)" disabled readOnly />
        </Field>
      </div>
      <p id="gst-preview" className="text-sm">
        {preview}
      </p>
      <p className="text-[13px] text-muted">Rates are never hard-coded. Changes apply to new invoices only; issued invoices keep the tax they were created with.</p>
      <div>
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
