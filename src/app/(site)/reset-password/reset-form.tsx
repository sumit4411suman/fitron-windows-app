"use client";

import { useActionState } from "react";
import { chooseNewPassword } from "../account-actions";
import { Button, Field, Input, Notice } from "@/components/ui";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(chooseNewPassword, undefined);
  const e = state?.errors ?? {};
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4" noValidate>
      {state?.message && (
        <Notice tone="alert">
          {state.message} {/expired/.test(state.message) && <a href="/forgot-password" className="underline">Get a new link</a>}
        </Notice>
      )}
      <input type="hidden" name="token" value={token} />
      <Field label="New password" error={e.password} hint="At least 10 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Type it again" error={e.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button variant="primary" disabled={pending} className="min-h-12">
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
