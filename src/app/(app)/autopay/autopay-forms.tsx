"use client";

import { useActionState } from "react";
import { changeAction, createAction } from "./actions";
import { useConfirmSubmit } from "@/components/confirm-dialog";
import { Button, Field, Input, Notice, Select } from "@/components/ui";

export function MandateForm({ members, plans }: { members: { id: string; label: string }[]; plans: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <div className="grid gap-3">
        <Field label="Member">
          <Input name="member" list="ap-members" placeholder="Member ID or name" autoComplete="off" required />
          <datalist id="ap-members">
            {members.map((m) => (
              <option key={m.id} value={m.label} />
            ))}
          </datalist>
        </Field>
        <Field label="Member's UPI ID" hint="Optional. The member can also pick it while approving.">
          <Input name="vpa" placeholder="name@okicici" autoComplete="off" />
        </Field>
        <Field label="Plan">
          <Select name="planId" required defaultValue="">
            <option value="" disabled>
              Choose
            </option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="First debit" hint="Defaults to the day after the current membership ends.">
          <Input name="startOn" type="date" />
        </Field>
      </div>
      <div>
        <Button variant="primary" disabled={pending}>
          {pending ? "Sending…" : "Send approval request"}
        </Button>
      </div>
    </form>
  );
}

export function MandateButton({ id, action: act, label, variant = "default", confirm }: { id: string; action: "pause" | "resume" | "cancel" | "approve-demo"; label: string; variant?: "default" | "primary" | "danger" | "ghost"; confirm?: string }) {
  const [state, action, pending] = useActionState(changeAction.bind(null, id, act), undefined);
  const [onSubmit, dialog] = useConfirmSubmit(() => (confirm ? { title: confirm, label, danger: variant === "danger" } : null));
  return (
    <form action={action} onSubmit={onSubmit} className="flex items-center gap-2">
      {dialog}
      {state?.message && !state.ok && <span className="text-sm text-alert">{state.message}</span>}
      <Button variant={variant} disabled={pending}>
        {label}
      </Button>
    </form>
  );
}
