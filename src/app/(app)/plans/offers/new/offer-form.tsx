"use client";

import { useActionState } from "react";
import { Button, Card, Field, Input, LinkButton, Notice, Select } from "@/components/ui";
import { saveOffer } from "../../actions";

export function OfferForm({ validTill }: { validTill: string }) {
  const [state, action, pending] = useActionState(saveOffer, undefined);
  const e = state?.errors ?? {};
  const v = (k: string, d = "") => ((state?.values?.[k] as string | undefined) ?? d);
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && !state.ok && <Notice tone="alert">{state.message}</Notice>}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" error={e.code} hint="Members say this at the desk, like DIWALI25.">
            <Input name="code" defaultValue={v("code")} required className="uppercase" />
          </Field>
          <Field label="Description" error={e.description}>
            <Input name="description" defaultValue={v("description")} placeholder="Festival offer" />
          </Field>
          <Field label="Discount type" error={e.type}>
            <Select name="type" defaultValue={v("type", "PERCENT")}>
              <option value="PERCENT">Percent</option>
              <option value="FLAT">Flat ₹</option>
            </Select>
          </Field>
          <Field label="Discount" error={e.value} hint="10 for 10%, or an amount in rupees">
            <Input name="value" inputMode="decimal" defaultValue={v("value")} required />
          </Field>
          <Field label="Valid till" error={e.validTill}>
            <Input name="validTill" type="date" defaultValue={v("validTill", validTill)} required />
          </Field>
          <Field label="Usage limit (optional)" error={e.usageLimit} hint="Leave empty for no limit">
            <Input name="usageLimit" type="number" min={1} defaultValue={v("usageLimit")} />
          </Field>
        </div>
      </Card>
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Create offer"}
        </Button>
        <LinkButton href="/plans">Cancel</LinkButton>
      </div>
    </form>
  );
}
