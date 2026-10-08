"use client";

import { useActionState, useState } from "react";
import { chooseNewPasswordWithCode, forgotPassword } from "../account-actions";
import { Button, Field, Input, Notice } from "@/components/ui";

/** Step 1 asks for the email; once the email is sent, step 2 takes the six-digit code and the new password. */
export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [asked, ask, asking] = useActionState(forgotPassword, undefined);
  const [state, action, pending] = useActionState(chooseNewPasswordWithCode, undefined);
  const e = state?.errors ?? {};
  if (!asked?.ok) {
    return (
      <form action={ask} className="flex flex-col gap-4" noValidate>
        {asked?.message && <Notice tone="alert">{asked.message}</Notice>}
        <Field label="Email" error={asked?.errors?.email}>
          <Input name="email" type="email" autoComplete="email" required value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </Field>
        <Button variant="primary" disabled={asking} className="min-h-12">
          {asking ? "Sending…" : "Email me a code and link"}
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Notice tone="ok">{asked.message}</Notice>
      <form action={action} key={state?.nonce} className="flex flex-col gap-4" noValidate>
        {state?.message && <Notice tone="alert">{state.message}</Notice>}
        <input type="hidden" name="email" value={email} />
        <Field label="Six-digit code" error={e.code} hint={`Sent to ${email}. Or just open the link in that email.`}>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus placeholder="123456" className="tracking-widest" defaultValue={state?.values?.code as string | undefined} />
        </Field>
        <Field label="New password" error={e.password} hint="At least 10 characters. This signs you out on every other device.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Field label="Type it again" error={e.confirm}>
          <Input name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <Button variant="primary" disabled={pending} className="min-h-12">
          {pending ? "Saving…" : "Save new password"}
        </Button>
      </form>
      <form action={ask} className="text-sm text-muted">
        <input type="hidden" name="email" value={email} />
        Nothing came? <button disabled={asking} className="text-accent underline">Send a new code</button>
      </form>
    </div>
  );
}
