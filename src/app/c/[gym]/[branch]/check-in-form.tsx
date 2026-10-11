"use client";

import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { checkInAction, type CheckInState } from "./actions";

/** The poster's check-in form: a mobile number, then a welcome, or the same plain "ask at the front desk" for every refusal. */
export function CheckInForm({ branchId }: { branchId: string }) {
  const [state, action, pending] = useActionState(checkInAction.bind(null, branchId), undefined as CheckInState);

  if (state?.status === "in") {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5 text-center">
        <p className="text-2xl font-semibold">Welcome, {state.firstName}</p>
        <p className="text-muted">You&apos;re checked in at {state.at}. Have a good workout.</p>
      </div>
    );
  }
  if (state?.status === "inside") {
    return (
      <div role="status" className="rounded-lg border border-line bg-surface p-5 text-center">
        <p className="text-xl font-semibold">You&apos;re already checked in</p>
        <p className="mt-1 text-muted">Have a good workout.</p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state?.status === "desk" && <Notice tone="alert">We couldn&apos;t check you in. Please ask at the front desk.</Notice>}
      {state?.status === "error" && <Notice tone="alert">{state.message}</Notice>}
      <Field label="Your mobile number" hint="The number you gave the gym when you joined.">
        <Input name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile" defaultValue={state?.status === "error" ? (state.phone ?? "") : ""} maxLength={30} required />
      </Field>
      <Button variant="primary" disabled={pending} className="min-h-12">
        {pending ? "Checking in…" : "Check in"}
      </Button>
    </form>
  );
}
