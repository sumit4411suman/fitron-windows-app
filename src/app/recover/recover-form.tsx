"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { recoverWithKey, type RecoverState } from "./actions";

export function RecoverForm() {
  const [state, action, pending] = useActionState<RecoverState, FormData>(recoverWithKey, undefined);
  const e = state?.errors ?? {};
  if (state?.recoveryKey) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="ok">Password changed. Every device signed in as the owner was signed out.</Notice>
        <p className="m-0 text-sm text-neutral-700">The old recovery key no longer works. This is your new one; save it as you did the first.</p>
        <output aria-label="New recovery key" className="rounded-md border border-line bg-surface px-4 py-3 text-center font-mono text-xl tracking-[0.12em] select-all">
          {state.recoveryKey}
        </output>
        <Link href="/login?reset=1" className="inline-flex justify-center rounded-md bg-accent px-4 py-[11px] text-[15px] font-semibold text-accent-ink">
          Sign in
        </Link>
      </div>
    );
  }
  return (
    <form key={state?.nonce} action={action} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <Field label="Owner's email" error={e.email}>
        <Input name="email" type="email" required autoComplete="username" defaultValue={state?.values?.email} />
      </Field>
      <Field label="Recovery key" error={e.recoveryKey} hint="The key shown when FITRON was set up, like K7QF-…">
        <Input name="recoveryKey" required autoComplete="off" spellCheck={false} className="font-mono uppercase" />
      </Field>
      <Field label="New password" error={e.password} hint="At least 10 characters.">
        <Input name="password" type="password" required autoComplete="new-password" />
      </Field>
      <Field label="New password again" error={e.confirm}>
        <Input name="confirm" type="password" required autoComplete="new-password" />
      </Field>
      <Button variant="primary" disabled={pending} className="py-[11px] text-[15px]">
        {pending ? "Checking…" : "Set new password"}
      </Button>
      <Link href="/login" className="self-start text-[13px] text-accent">
        Back to sign in
      </Link>
    </form>
  );
}
