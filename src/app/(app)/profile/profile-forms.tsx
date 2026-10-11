"use client";

import { useActionState } from "react";
import { changePhoto, savePassword, saveProfile } from "./actions";
import { Button, Field, Input, Notice } from "@/components/ui";
import { PhotoUpload } from "@/components/photo-upload";

export function PhotoForm({ hasPhoto }: { hasPhoto: boolean }) {
  return <PhotoUpload hasPhoto={hasPhoto} action={changePhoto} />;
}

export function ProfileForm({ name, phone }: { name: string; phone: string }) {
  const [state, action, pending] = useActionState(saveProfile, undefined);
  const e = state?.errors ?? {};
  const v = state?.values;
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={e.name}>
          <Input name="name" defaultValue={(v?.name as string | undefined) ?? name} autoComplete="name" required />
        </Field>
        <Field label="Mobile" error={e.phone}>
          <Input name="phone" type="tel" inputMode="numeric" maxLength={14} defaultValue={(v?.phone as string | undefined) ?? phone} autoComplete="tel" required />
        </Field>
      </div>
      <div>
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(savePassword, undefined);
  const e = state?.errors ?? {};
  return (
    <form action={action} key={state?.nonce} className="flex max-w-md flex-col gap-4">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <Field label="Current password" error={e.current}>
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" error={e.password} hint="At least 10 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label="Confirm new password" error={e.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <p className="text-xs text-muted">Changing your password signs you out on every other device.</p>
      <div>
        <Button variant="primary" disabled={pending}>
          {pending ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
