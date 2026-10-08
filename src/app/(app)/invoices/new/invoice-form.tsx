"use client";

import { useActionState, useState } from "react";
import { newInvoice } from "../../billing-actions";
import { Button, Card, Field, Input, LinkButton, Notice, Select } from "@/components/ui";
import { invoiceTotals } from "@/lib/domain/billing";
import { formatInr } from "@/lib/format";
import { LINE_CATEGORIES, METHODS } from "@/lib/validation/billing";

type Line = { desc: string; category: string; qty: string; rate: string; discount: string; taxable: boolean };
const blank = (): Line => ({ desc: "", category: "Personal Training", qty: "1", rate: "", discount: "", taxable: true });
const paise = (s: string) => {
  const n = Number(s.replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function InvoiceForm({ members, memberId, today, taxRate }: { members: { id: string; label: string }[]; memberId?: string; today: string; taxRate: number }) {
  const [state, action, pending] = useActionState(newInvoice, undefined);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [pay, setPay] = useState<string | null>(null);
  const [member, setMember] = useState(memberId ?? "");
  const e = state?.errors ?? {};
  const t = invoiceTotals(lines.map((l) => ({ qty: Number(l.qty) || 0, rate: paise(l.rate), discount: paise(l.discount), taxRate: l.taxable ? taxRate : 0 })));
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Member" error={e.memberId}>
            <Select name="memberId" value={member} onChange={(ev) => setMember(ev.target.value)} required>
              <option value="" disabled>
                Choose a member
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice date" error={e.date}>
            <Input name="date" type="date" defaultValue={today} required />
          </Field>
          <Field label="Due date" error={e.dueDate}>
            <Input name="dueDate" type="date" defaultValue={today} required />
          </Field>
        </div>
      </Card>
      <Card title="Items">
        <div className="flex flex-col gap-4">
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 border-b border-line pb-4 sm:grid-cols-[2fr_1.2fr_0.6fr_1fr_1fr_auto]">
              <Input name="desc" placeholder="Description" value={l.desc} onChange={(ev) => set(i, { desc: ev.target.value })} aria-label="Description" />
              <Select name="category" value={l.category} onChange={(ev) => set(i, { category: ev.target.value })} aria-label="Category">
                {LINE_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
              <Input name="qty" type="number" min={1} value={l.qty} onChange={(ev) => set(i, { qty: ev.target.value })} aria-label="Quantity" />
              <Input name="rate" inputMode="decimal" placeholder="Rate ₹" value={l.rate} onChange={(ev) => set(i, { rate: ev.target.value })} aria-label="Rate" />
              <Input name="lineDiscount" inputMode="decimal" placeholder="Discount ₹" value={l.discount} onChange={(ev) => set(i, { discount: ev.target.value })} aria-label="Discount" />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="taxable" value={i} checked={l.taxable} onChange={(ev) => set(i, { taxable: ev.target.checked })} className="size-4" />
                  GST
                </label>
                {lines.length > 1 && (
                  <button type="button" className="text-sm text-alert" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          <div>
            <Button type="button" onClick={() => setLines((ls) => [...ls, blank()])}>
              Add line
            </Button>
          </div>
          <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Subtotal</dt>
            <dd className="text-right">{formatInr(t.subtotal)}</dd>
            <dt className="text-muted">Discount</dt>
            <dd className="text-right">− {formatInr(t.discount)}</dd>
            <dt className="text-muted">GST</dt>
            <dd className="text-right">{formatInr(t.tax)}</dd>
            <dt className="font-semibold">Total</dt>
            <dd className="text-right text-lg font-semibold">{formatInr(t.total)}</dd>
          </dl>
        </div>
      </Card>
      <Card title="Collect now">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Amount (₹)" error={e.payAmount} hint="Enter 0 to invoice without collecting">
            <Input name="payAmount" inputMode="decimal" value={pay ?? String(t.total / 100)} onChange={(ev) => setPay(ev.target.value)} />
          </Field>
          <Field label="Method" error={e.payMethod}>
            <Select name="payMethod" defaultValue="UPI">
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" error={e.payRef}>
            <Input name="payRef" />
          </Field>
        </div>
      </Card>
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Generate invoice"}
        </Button>
        <LinkButton href="/invoices">Cancel</LinkButton>
      </div>
    </form>
  );
}
