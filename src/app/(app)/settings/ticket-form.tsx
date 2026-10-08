"use client";

import { useActionState } from "react";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { PRIORITIES, TOPICS } from "@/lib/domain/support";
import { raiseTicketAction } from "./actions";

export function TicketForm() {
  const [state, action, pending] = useActionState(raiseTicketAction, undefined);
  const v = state?.values ?? {};
  const val = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined);
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-3" noValidate>
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Topic" error={state?.errors?.topic}>
          <Select name="topic" defaultValue={val("topic") ?? TOPICS[0]}>
            {TOPICS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" error={state?.errors?.priority}>
          <Select name="priority" defaultValue={val("priority") ?? PRIORITIES[0]}>
            {PRIORITIES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Subject" error={state?.errors?.subject}>
        <Input name="subject" placeholder="e.g. Invoice PDF not downloading" defaultValue={val("subject")} />
      </Field>
      <Field label="What happened?" error={state?.errors?.message}>
        <Textarea name="message" rows={4} placeholder="Steps, member ID or invoice number, and what you expected" defaultValue={val("message")} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted">Your app version and browser are attached automatically.</span>
        <Button variant="primary" disabled={pending}>
          <PaperPlaneTiltIcon size={16} /> Send to support
        </Button>
      </div>
    </form>
  );
}
