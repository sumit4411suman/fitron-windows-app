"use client";

import Link from "next/link";
import { useActionState } from "react";
import { sendSignInEmail, verifySignInCode } from "./actions";
import { Button, Field, Input, Notice } from "@/components/ui";

/** Sign in without a password: ask for an email, then type the six-digit code that came with the link. */
export function EmailSignInForm({ next }: { next?: string }) {
  const [asked, ask, asking] = useActionState(sendSignInEmail, undefined);
  const [state, verify, verifying] = useActionState(verifySignInCode, undefined);
  const email = state?.email || asked?.email || "";
  if (!asked?.sent) {
    return (
      <form action={ask} className="flex flex-col gap-4" noValidate>
        {asked?.message && <Notice tone="alert">{asked.message}</Notice>}
        <Field label="Email" error={asked?.errors?.email} hint="We email you a six-digit code and a sign-in link. No password needed.">
          <Input name="email" type="email" autoComplete="username" required autoFocus defaultValue={email} />
        </Field>
        <Button variant="primary" disabled={asking} className="py-[11px] text-[15px]">
          {asking ? "Sending…" : "Email me a code"}
        </Button>
        <Link href={next ? `/login?${new URLSearchParams({ next })}` : "/login"} className="self-start py-1 text-[13px] text-accent no-underline">Use my password instead</Link>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="ok">{asked.message}</Notice>
      <form action={verify} className="flex flex-col gap-4" noValidate>
        {state?.message && <Notice tone="alert">{state.message}</Notice>}
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Six-digit code" error={state?.errors?.code} hint={`Sent to ${email}. Or open the link in that email.`}>
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus placeholder="123456" className="tracking-widest" />
        </Field>
        <Button variant="primary" disabled={verifying} className="py-[11px] text-[15px]">
          {verifying ? "Checking…" : "Verify and sign in"}
        </Button>
      </form>
      <form action={ask} className="text-[13px] text-neutral-700">
        <input type="hidden" name="email" value={email} />
        Nothing came? <button disabled={asking} className="text-accent underline">Send a new code</button>
        {" · "}
        <Link href="/login" className="text-accent underline">Use my password</Link>
      </form>
    </div>
  );
}
