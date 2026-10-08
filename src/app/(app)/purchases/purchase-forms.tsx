"use client";

import { useActionState, useState } from "react";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { ReasonForm } from "@/components/reason-form";
import { ASSET_CATEGORIES } from "@/lib/domain/assets";
import { METHODS } from "@/lib/validation/billing";
import { formatInr } from "@/lib/domain/billing";
import { cancelPurchaseAction, createPurchaseAction, payVendorAction } from "./actions";

type Line = { type: "STOCK" | "ASSET" | "EXPENSE"; description: string; ref: string; newSku: string; newPrice: string; qty: string; rate: string; gstPct: string };
type Product = { id: string; name: string; sku: string; cost: number };
type Category = { id: string; name: string; group: string };

const TYPE_LABEL = { STOCK: "Stock for the counter", ASSET: "Equipment (asset)", EXPENSE: "Expense" } as const;
const GST = ["0", "5", "12", "18", "28"];

const blank = (type: Line["type"]): Line => ({ type, description: "", ref: type === "ASSET" ? ASSET_CATEGORIES[0] : "", newSku: "", newPrice: "", qty: "1", rate: "", gstPct: type === "EXPENSE" ? "0" : "18" });
const paise = (s: string) => Math.round(Number(s.replace(/[₹,\s]/g, "")) * 100) || 0;
const amountOf = (l: Line) => Math.round((Number(l.qty) || 0) * paise(l.rate) * (1 + (Number(l.gstPct) || 0) / 100));

export function PurchaseForm({ products, categories, vendors, today, startType }: { products: Product[]; categories: Category[]; vendors: string[]; today: string; startType?: Line["type"] }) {
  const [state, action, pending] = useActionState(createPurchaseAction, undefined);
  const sent = (state?.values as Record<string, string> | undefined) ?? {};
  const [lines, setLines] = useState<Line[]>(() => {
    try {
      if (sent.lines) return JSON.parse(sent.lines) as Line[];
    } catch {}
    return [blank(startType ?? "STOCK")];
  });
  const [paid, setPaid] = useState(sent.paid ?? "full");
  const e = state?.errors ?? {};
  const total = lines.reduce((s, l) => s + amountOf(l), 0);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const groups = [...new Set(categories.map((c) => c.group))];

  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Supplier" error={e.vendor} className="sm:col-span-2">
          <Input name="vendor" list="vendors" defaultValue={sent.vendor} required autoComplete="off" />
          <datalist id="vendors">
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="Bill date" error={e.date}>
          <Input name="date" type="date" max={today} defaultValue={sent.date ?? today} required />
        </Field>
        <Field label="Bill no." error={e.billNo}>
          <Input name="billNo" defaultValue={sent.billNo} />
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        {lines.map((l, i) => (
          <fieldset key={i} className="rounded-xl border border-line p-3">
            <legend className="px-1 text-sm text-muted">Line {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Field label="Type">
                <Select value={l.type} onChange={(ev) => set(i, { ...blank(ev.target.value as Line["type"]), description: l.description, qty: l.qty, rate: l.rate })}>
                  {(Object.keys(TYPE_LABEL) as Line["type"][]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              {l.type === "STOCK" && (
                <Field label="Product">
                  <Select
                    value={l.ref}
                    onChange={(ev) => {
                      const p = products.find((x) => x.id === ev.target.value);
                      set(i, { ref: ev.target.value, description: p ? p.name : l.description });
                    }}
                    required
                  >
                    <option value="" disabled>
                      Choose
                    </option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                    <option value="new">New product…</option>
                  </Select>
                </Field>
              )}
              {l.type === "ASSET" && (
                <Field label="Asset category">
                  <Select value={l.ref} onChange={(ev) => set(i, { ref: ev.target.value })}>
                    {ASSET_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
              )}
              {l.type === "EXPENSE" && (
                <Field label="Expense category">
                  <Select value={l.ref} onChange={(ev) => set(i, { ref: ev.target.value })} required>
                    <option value="" disabled>
                      Choose
                    </option>
                    {groups.map((g) => (
                      <optgroup key={g} label={g}>
                        {categories
                          .filter((c) => c.group === g && c.id !== "equipment-purchase")
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Description" className="lg:col-span-2">
                <Input value={l.description} onChange={(ev) => set(i, { description: ev.target.value })} required />
              </Field>
              <Field label="Qty">
                <Input type="number" min={1} value={l.qty} onChange={(ev) => set(i, { qty: ev.target.value })} required />
              </Field>
              <Field label="Rate before GST (₹)">
                <Input inputMode="decimal" value={l.rate} onChange={(ev) => set(i, { rate: ev.target.value })} required />
              </Field>
              {l.type === "STOCK" && l.ref === "new" && (
                <>
                  <Field label="New SKU">
                    <Input value={l.newSku} onChange={(ev) => set(i, { newSku: ev.target.value })} required />
                  </Field>
                  <Field label="Selling price (₹)">
                    <Input inputMode="decimal" value={l.newPrice} onChange={(ev) => set(i, { newPrice: ev.target.value })} required />
                  </Field>
                </>
              )}
              <Field label="GST %">
                <Select value={l.gstPct} onChange={(ev) => set(i, { gstPct: ev.target.value })}>
                  {GST.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end justify-between gap-2 sm:col-span-2 lg:col-span-1 lg:flex-col lg:items-end">
                <span className="text-sm tabular-nums">{formatInr(amountOf(l))}</span>
                {lines.length > 1 && (
                  <Button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TYPE_LABEL) as Line["type"][]).map((t) => (
            <Button key={t} type="button" onClick={() => setLines((ls) => [...ls, blank(t)])}>
              + {TYPE_LABEL[t]}
            </Button>
          ))}
        </div>
      </div>

      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Paid">
          <Select name="paid" value={paid} onChange={(ev) => setPaid(ev.target.value)}>
            <option value="full">In full</option>
            <option value="part">Part now</option>
            <option value="none">Not yet (on credit)</option>
          </Select>
        </Field>
        {paid !== "none" && (
          <Field label="Paid by" error={e.method}>
            <Select name="method" defaultValue={sent.method ?? "Bank Transfer"}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
        )}
        {paid === "none" && <input type="hidden" name="method" value="Bank Transfer" />}
        {paid === "part" && (
          <Field label="Paid now (₹)" error={e.paidAmount}>
            <Input name="paidAmount" inputMode="decimal" defaultValue={sent.paidAmount} required />
          </Field>
        )}
        <Field label="Notes" error={e.notes} className={paid === "part" ? "" : "sm:col-span-2"}>
          <Input name="notes" defaultValue={sent.notes} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save purchase"}
        </Button>
        <span className="text-sm">
          Bill total <strong className="tabular-nums">{formatInr(total)}</strong>
        </span>
      </div>
      <p className="text-sm text-muted">Stock lines add to product stock. Equipment goes to the asset register, not profit and loss. Anything unpaid shows under supplier dues.</p>
    </form>
  );
}

export function PayVendorForm({ id, balance, today, billDate }: { id: string; balance: number; today: string; billDate: string }) {
  const [state, action, pending] = useActionState(payVendorAction.bind(null, id), undefined);
  const e = state?.errors ?? {};
  const v = (state?.values as Record<string, string> | undefined) ?? {};
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-3">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)" error={e.amount}>
          <Input name="amount" inputMode="decimal" defaultValue={v.amount ?? String(balance / 100)} required />
        </Field>
        <Field label="Date" error={e.date}>
          <Input name="date" type="date" min={billDate} max={today} defaultValue={v.date ?? today} required />
        </Field>
        <Field label="Paid by" error={e.method}>
          <Select name="method" defaultValue={v.method ?? "Bank Transfer"}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reference / UTR" error={e.reference}>
          <Input name="reference" defaultValue={v.reference} placeholder="UTR or cheque no." />
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

export function CancelPurchase({ id }: { id: string }) {
  return <ReasonForm action={cancelPurchaseAction.bind(null, id)} label="Cancel bill" confirm="Cancel this bill? Its expenses are voided, its stock taken back out and its assets removed. Money paid is treated as refunded." />;
}
