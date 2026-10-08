"use client";

import { useActionState } from "react";
import { saveProductAction, stockAction } from "./actions";
import { Button, Field, Input, LinkButton, Notice, Select } from "@/components/ui";

type Values = Partial<Record<string, string | null>>;

export function ProductForm({ id, values = {}, categories }: { id?: string; values?: Values; categories: string[] }) {
  const [state, action, pending] = useActionState(saveProductAction.bind(null, id ?? null), undefined);
  const e = state?.errors ?? {};
  const sent = state?.ok ? undefined : state?.values;
  const v = (k: string) => (sent ? (sent[k] as string | undefined) : (values[k] ?? undefined));
  const checked = (k: string, def: boolean) => (sent ? sent[k] === "on" : values[k] != null ? values[k] === "on" : def);
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={e.name}>
          <Input name="name" defaultValue={v("name")} required />
        </Field>
        <Field label="SKU / short code" error={e.sku}>
          <Input name="sku" defaultValue={v("sku")} required />
        </Field>
        <Field label="Category" error={e.category}>
          <Select name="category" defaultValue={v("category") ?? categories[0]}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Selling price before GST (₹)" error={e.price}>
          <Input name="price" inputMode="decimal" defaultValue={v("price")} required />
        </Field>
        <Field label="Cost price (₹)" error={e.cost} hint="Updated automatically when you receive stock at a new cost.">
          <Input name="cost" inputMode="decimal" defaultValue={v("cost")} />
        </Field>
        <Field label="Reorder level" error={e.reorderLevel}>
          <Input name="reorderLevel" type="number" min={0} defaultValue={v("reorderLevel")} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="trackStock" defaultChecked={checked("trackStock", true)} className="size-4" /> Track stock (untick for services like a day pass)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="gstApplicable" defaultChecked={checked("gstApplicable", true)} className="size-4" /> Charge GST
        </label>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add product"}
        </Button>
        <LinkButton href={id ? `/products/${id}` : "/products"}>Cancel</LinkButton>
      </div>
    </form>
  );
}

export function StockForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(stockAction.bind(null, id), undefined);
  const e = state?.errors ?? {};
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-3">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Quantity" error={e.qty} hint="Negative to write off damaged or missing stock.">
          <Input name="qty" type="number" required />
        </Field>
        <Field label="Cost per unit (₹)" error={e.unitCost}>
          <Input name="unitCost" inputMode="decimal" />
        </Field>
        <Field label="Note" error={e.note}>
          <Input name="note" placeholder="Supplier, bill no." />
        </Field>
      </div>
      <div>
        <Button variant="primary" disabled={pending}>
          Update stock
        </Button>
      </div>
    </form>
  );
}
