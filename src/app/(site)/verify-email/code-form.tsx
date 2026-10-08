"use client";

import { useActionState } from "react";
import { confirmEmailWithCode } from "../account-actions";
import { Button, Field, Input, Notice } from "@/components/ui";

/** The six-digit code from the sign-up email, as an alternative to opening its link. */
export function CodeForm({ email }: { email?: string }) {
  const [state, action, pending] = useActionState(confirmEmailWithCode, undefined);
  const e = state?.errors ?? {};
  return (
    <form action={action} key={state?.nonce} className="mb-8 flex flex-col gap-4" noValidate>
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      {email ? (
        <input type="hidden" name="email" value={email} />
      ) : (
        <Field label="Email" error={e.email}>
          <Input name="email" type="email" autoComplete="email" required defaultValue={state?.values?.email as string | undefined} />
        </Field>
      )}
      <Field label="Six-digit code" error={e.code} hint="From the email we sent. Or just open the link in it.">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required placeholder="123456" className="tracking-widest" defaultValue={state?.values?.code as string | undefined} />
      </Field>
      <Button variant="primary" disabled={pending} className="min-h-12">
        {pending ? "Checking…" : "Confirm my email"}
      </Button>
    </form>
  );
}
