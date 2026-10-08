"use client";

import { useState } from "react";
import { saveTax } from "./actions";
import { Button, Field, Input, Select } from "@/components/ui";
import { gstPreview } from "@/lib/domain/tax";

type Tax = { enabled: boolean; rate: number; type: "CGST+SGST" | "IGST"; gstin?: string; sac?: string };

/** Settings › Billing & GST, with the prototype's live preview line recomputed as the fields change. */
export function TaxForm({ tax, invoicePrefix, nextNumber }: { tax: Tax; invoicePrefix: string; nextNumber: number }) {
  const [enabled, setEnabled] = useState(tax.enabled);
  const [rate, setRate] = useState(String(tax.rate));
  const [type, setType] = useState<Tax["type"]>(tax.type);
  const [prefix, setPrefix] = useState(invoicePrefix);
  const preview = gstPreview({ enabled, rate: Number(rate) || 0, type }, prefix.toUpperCase(), nextNumber);

  return (
    <form action={saveTax} className="flex flex-col gap-[22px]">
      <label className="flex cursor-pointer items-center gap-2.5 text-[15px]">
        <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-[18px] accent-accent" />
        Charge GST on invoices
      </label>
      <div className="grid gap-x-6 gap-y-[18px] sm:grid-cols-2 lg:grid-cols-3">
        <Field label="GST rate (%)">
          <Input name="rate" type="number" step="0.01" min={0} max={28} value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label="Tax type">
          <Select name="type" value={type} onChange={(e) => setType(e.target.value as Tax["type"])}>
            <option value="CGST+SGST">CGST + SGST (intra-state)</option>
            <option value="IGST">IGST (inter-state)</option>
          </Select>
        </Field>
        <Field label="GSTIN" hint="Printed on invoices under your gym's name.">
          <Input name="gstin" defaultValue={tax.gstin ?? ""} placeholder="20ABCDE1234F1Z5" maxLength={15} className="uppercase" autoCapitalize="characters" />
        </Field>
        <Field label="SAC code">
          <Input name="sac" defaultValue={tax.sac ?? "999723"} inputMode="numeric" />
        </Field>
        <Field label="Invoice prefix" hint="Numbers keep counting from where they are; only the prefix changes.">
          <Input name="invoicePrefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={10} className="uppercase" autoCapitalize="characters" />
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
        <Button variant="primary">Save</Button>
      </div>
    </form>
  );
}
