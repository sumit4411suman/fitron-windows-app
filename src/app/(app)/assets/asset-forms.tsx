"use client";

import { useActionState, useState } from "react";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { ReasonForm } from "@/components/reason-form";
import { ASSET_CATEGORIES, DEP_DEFAULT, type AssetCategory } from "@/lib/domain/assets";
import { METHODS } from "@/lib/validation/billing";
import { disposeAction, removeAssetAction, saveAssetAction, undoDisposalAction } from "./actions";

type Values = Record<string, string>;

export function AssetForm({ id, values, today, fromPurchase }: { id?: string; values?: Values; today: string; fromPurchase?: boolean }) {
  const [state, action, pending] = useActionState(saveAssetAction.bind(null, id ?? null), undefined);
  const e = state?.errors ?? {};
  const v = { ...values, ...((state?.values as Values | undefined) ?? {}) };
  const [category, setCategory] = useState<AssetCategory>((v.category as AssetCategory) ?? ASSET_CATEGORIES[0]);
  const [method, setMethod] = useState(v.method ?? "WDV");
  const [rate, life] = DEP_DEFAULT[category];
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-3">
      {state?.message && !state.ok && <Notice tone="alert">{state.message}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Asset" error={e.name} className="sm:col-span-2">
          <Input name="name" defaultValue={v.name} placeholder="e.g. Commercial treadmill" required />
        </Field>
        <Field label="Category" error={e.category}>
          <Select name="category" value={category} onChange={(ev) => setCategory(ev.target.value as AssetCategory)}>
            {ASSET_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity" error={e.qty}>
          <Input name="qty" type="number" min={1} defaultValue={v.qty ?? "1"} required />
        </Field>
        <Field label="Purchase date" error={e.purchaseDate}>
          <Input name="purchaseDate" type="date" max={today} defaultValue={v.purchaseDate ?? today} readOnly={fromPurchase} required />
        </Field>
        <Field label="Total cost incl. GST (₹)" error={e.cost}>
          <Input name="cost" inputMode="decimal" defaultValue={v.cost} readOnly={fromPurchase} required />
        </Field>
        <Field label="Salvage value (₹)" error={e.salvage} hint="What it will be worth at the end. Usually 0.">
          <Input name="salvage" inputMode="decimal" defaultValue={v.salvage ?? "0"} />
        </Field>
        <Field label="Paid from" error={e.payMethod} hint={fromPurchase ? "Set by the purchase bill." : "Not from the gym's books: bought earlier or paid by the owner."}>
          {fromPurchase ? (
            <>
              <input type="hidden" name="payMethod" value="none" />
              <Input value={v.payMethod || "Purchase bill"} readOnly />
            </>
          ) : (
            <Select name="payMethod" defaultValue={v.payMethod ?? "Bank Transfer"}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
              <option value="none">Not from the gym&apos;s books</option>
            </Select>
          )}
        </Field>
        <Field label="Depreciation method" error={e.method}>
          <Select name="method" value={method} onChange={(ev) => setMethod(ev.target.value)}>
            <option value="WDV">Written-down value (WDV)</option>
            <option value="SLM">Straight line (SLM)</option>
          </Select>
        </Field>
        {method === "WDV" ? (
          <Field label="WDV rate (% per year)" error={e.rate} hint={`Income-tax default for ${category.toLowerCase()}: ${rate}%`}>
            <Input name="rate" inputMode="decimal" key={`r-${category}`} defaultValue={v.rate || String(rate)} required />
          </Field>
        ) : (
          <Field label="Useful life (years, SLM)" error={e.life} hint={`Typical for ${category.toLowerCase()}: ${life} years`}>
            <Input name="life" type="number" min={1} key={`l-${category}`} defaultValue={v.life || String(life)} required />
          </Field>
        )}
        <Field label="Supplier" error={e.vendor}>
          <Input name="vendor" defaultValue={v.vendor} />
        </Field>
        <Field label="Bill no." error={e.billNo}>
          <Input name="billNo" defaultValue={v.billNo} />
        </Field>
        <Field label="Serial no." error={e.serial}>
          <Input name="serial" defaultValue={v.serial} />
        </Field>
        <Field label="Notes" error={e.notes} className="sm:col-span-2 lg:col-span-4">
          <Textarea name="notes" rows={2} defaultValue={v.notes} />
        </Field>
      </div>
      <p className="text-sm text-muted">The asset goes to the register, not to profit and loss. Profit and loss carries its monthly depreciation instead.</p>
      <div>
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add asset"}
        </Button>
      </div>
    </form>
  );
}

export function DisposeForm({ id, today, minDate }: { id: string; today: string; minDate: string }) {
  const [state, action, pending] = useActionState(disposeAction.bind(null, id), undefined);
  const [type, setType] = useState("SOLD");
  const e = state?.errors ?? {};
  const v = (state?.values as Values | undefined) ?? {};
  if (state?.ok) return <Notice tone="ok">{state.message}</Notice>;
  return (
    <form
      action={action}
      key={state?.nonce}
      onSubmit={(ev) => {
        if (!window.confirm("Record this disposal? Depreciation stops after this month.")) ev.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happened">
          <Select name="type" value={type} onChange={(ev) => setType(ev.target.value)}>
            <option value="SOLD">Sold</option>
            <option value="SCRAPPED">Scrapped</option>
          </Select>
        </Field>
        <Field label="Date" error={e.date}>
          <Input name="date" type="date" min={minDate} max={today} defaultValue={v.date ?? today} required />
        </Field>
        {type === "SOLD" && (
          <>
            <Field label="Amount received (₹)" error={e.amount}>
              <Input name="amount" inputMode="decimal" defaultValue={v.amount} required />
            </Field>
            <Field label="Received by" error={e.method}>
              <Select name="method" defaultValue={v.method ?? "Cash"}>
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field label="Note" error={e.note} className="sm:col-span-2">
          <Input name="note" defaultValue={v.note} placeholder="Buyer, reason" />
        </Field>
      </div>
      <div>
        <Button variant="danger" disabled={pending}>
          {pending ? "Saving…" : type === "SOLD" ? "Mark as sold" : "Mark as scrapped"}
        </Button>
      </div>
    </form>
  );
}

export function UndoDisposal({ id }: { id: string }) {
  const [state, action, pending] = useActionState(undoDisposalAction.bind(null, id), undefined);
  return (
    <form
      action={action}
      onSubmit={(ev) => {
        if (!window.confirm("Put this asset back in use? The sale or scrapping is undone.")) ev.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      <Button disabled={pending}>Undo disposal</Button>
      {state?.message && !state.ok && <span className="text-sm text-alert">{state.message}</span>}
    </form>
  );
}

export function RemoveAsset({ id }: { id: string }) {
  return <ReasonForm action={removeAssetAction.bind(null, id)} label="Remove asset" confirm="Remove this asset? Use this only for one added by mistake. Its cash-book expense is voided too." />;
}
