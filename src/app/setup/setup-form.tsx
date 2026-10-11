"use client";

import { useActionState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { setUpGym, type SetupState } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setUpGym, undefined);
  const e = state?.errors ?? {};

  return (
    <form key={state?.nonce} action={action} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <Field label="Gym name" error={e.gymName}>
        <Input name="gymName" required autoFocus placeholder="Power Haus Gym" defaultValue={state?.values?.gymName} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First branch" error={e.branchName}>
          <Input name="branchName" required defaultValue={state?.values?.branchName ?? "Main"} />
        </Field>
        <Field label="Mobile number" error={e.phone}>
          <Input name="phone" inputMode="numeric" required placeholder="10-digit mobile" defaultValue={state?.values?.phone} />
        </Field>
      </div>
      <Field label="Address" error={e.address}>
        <Input name="address" placeholder="Shop / building, area, city" defaultValue={state?.values?.address} />
      </Field>
      <Field label="Your name" error={e.ownerName}>
        <Input name="ownerName" required autoComplete="name" defaultValue={state?.values?.ownerName} />
      </Field>
      <Field label="Email" error={e.email} hint="You sign in with this. It stays on this computer.">
        <Input name="email" type="email" required autoComplete="username" defaultValue={state?.values?.email} />
      </Field>
      <Field label="Password" error={e.password} hint="At least 10 characters.">
        <Input name="password" type="password" required autoComplete="new-password" />
      </Field>
      <Field label="Password again" error={e.confirm}>
        <Input name="confirm" type="password" required autoComplete="new-password" />
      </Field>
      <Button variant="primary" disabled={pending} className="py-[11px] text-[15px]">
        {pending ? "Setting up…" : "Create gym and owner"}
      </Button>
    </form>
  );
}
