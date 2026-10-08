"use client";

import Link from "next/link";
import { useActionState } from "react";
import { verifyTwoStep } from "./actions";
import { Button, Field, Input, Notice } from "@/components/ui";

export function TwoStepForm() {
  const [state, action, pending] = useActionState(verifyTwoStep, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <Field label="Code from your authenticator app" hint="Six digits. Lost your phone? Type one of your recovery codes instead.">
        <Input name="code" inputMode="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} required autoFocus maxLength={20} placeholder="123456" className="tracking-widest" />
      </Field>
      <Button variant="primary" disabled={pending} className="py-[11px] text-[15px]">
        {pending ? "Checking…" : "Verify and sign in"}
      </Button>
      <Link href="/login" className="self-start py-1 text-[13px] text-accent no-underline">
        Start again with a different account
      </Link>
    </form>
  );
}
