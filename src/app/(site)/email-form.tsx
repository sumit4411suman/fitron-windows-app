"use client";

import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import type { FormState } from "@/lib/validation/common";

/** One email field and a button; used to resend a verification link and to ask for a reset link. */
export function EmailForm({ action: run, email, label }: { action: (s: FormState, fd: FormData) => Promise<FormState>; email?: string; label: string }) {
  const [state, action, pending] = useActionState(run, undefined);
  const v = state?.ok ? undefined : (state?.values?.email as string | undefined);
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4" noValidate>
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <Field label="Email" error={state?.errors?.email}>
        <Input name="email" type="email" autoComplete="email" defaultValue={v ?? email} required />
      </Field>
      <Button variant="primary" disabled={pending} className="min-h-12">
        {pending ? "Sending…" : label}
      </Button>
    </form>
  );
}
