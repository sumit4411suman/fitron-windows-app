"use client";

import { useActionState, useState } from "react";
import { Button, Field, Input, Notice } from "./ui";

type Result = { ok?: boolean; message?: string; errors?: Record<string, string[] | undefined> } | undefined;

/** A danger button that opens a "reason" field before running an irreversible-looking action. */
export function ReasonForm({ action: act, label, confirm, done, compact }: { action: (s: Result, fd: FormData) => Promise<Result>; label: string; confirm: string; done?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(act, undefined);
  if (state?.ok) return <Notice tone="ok">{state.message}</Notice>;
  if (done) return null;
  if (!open)
    return (
      <Button type="button" variant={compact ? "ghost" : "danger"} className={compact ? "text-alert-700 hover:bg-alert-soft" : undefined} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <form
      action={action}
      onSubmit={(ev) => {
        if (!window.confirm(confirm)) ev.preventDefault();
      }}
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <Field label="Reason" error={state?.errors?.reason} className="flex-1">
        <Input name="reason" required minLength={3} autoFocus />
      </Field>
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <div className="flex gap-2">
        <Button variant="danger" disabled={pending}>
          {label}
        </Button>
        <Button type="button" onClick={() => setOpen(false)}>
          Keep
        </Button>
      </div>
    </form>
  );
}

