"use client";

import { useActionState } from "react";
import { saveLead, stageAction } from "./actions";
import { Button, Field, Input, LinkButton, Notice, Select, Textarea } from "@/components/ui";
import { ReasonForm } from "@/components/reason-form";
import { SOURCES } from "@/lib/validation/member";
import type { LeadStage } from "@/lib/validation/frontdesk";

type Values = Partial<Record<string, string | null>>;

export function LeadForm({ id, values = {}, staff, interests, meId }: { id?: string; values?: Values; staff: { id: string; name: string }[]; interests: string[]; meId: string }) {
  const [state, action, pending] = useActionState(saveLead.bind(null, id ?? null), undefined);
  const e = state?.errors ?? {};
  const sent = state?.ok ? undefined : state?.values;
  const v = (k: string) => (sent ? (sent[k] as string | undefined) : (values[k] ?? undefined));
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={e.name}>
          <Input name="name" defaultValue={v("name")} required />
        </Field>
        <Field label="Mobile" error={e.phone}>
          <Input name="phone" inputMode="tel" defaultValue={v("phone")} required />
        </Field>
        <Field label="Source" error={e.source}>
          <Select name="source" defaultValue={v("source") ?? "Walk-in"}>
            {SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Interested in" error={e.interest}>
          <Input name="interest" list="interests" defaultValue={v("interest")} required />
          <datalist id="interests">
            {interests.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
        </Field>
        <Field label="Follow up on" error={e.followUpOn} hint="Defaults to tomorrow.">
          <Input name="followUpOn" type="date" defaultValue={v("followUpOn")} />
        </Field>
        <Field label="Trial date (optional)" error={e.trialOn}>
          <Input name="trialOn" type="date" defaultValue={v("trialOn")} />
        </Field>
        <Field label="Follow-up by" error={e.ownerId}>
          <Select name="ownerId" defaultValue={v("ownerId") ?? meId}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" error={e.notes} className="sm:col-span-2">
          <Textarea name="notes" rows={3} defaultValue={v("notes")} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : id ? "Save changes" : "Add lead"}
        </Button>
        <LinkButton href={id ? `/leads/${id}` : "/leads"}>Cancel</LinkButton>
      </div>
    </form>
  );
}

export function StageButton({ id, stage, label, primary }: { id: string; stage: LeadStage; label: string; primary?: boolean }) {
  const [state, action, pending] = useActionState(stageAction.bind(null, id, stage), undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      {state?.message && !state.ok && <span className="text-sm text-alert">{state.message}</span>}
      <Button variant={primary ? "primary" : "default"} disabled={pending}>
        {label}
      </Button>
    </form>
  );
}

export function LostButton({ id }: { id: string }) {
  return <ReasonForm action={stageAction.bind(null, id, "Lost")} label="Mark lost" confirm="Mark this lead as lost?" />;
}
