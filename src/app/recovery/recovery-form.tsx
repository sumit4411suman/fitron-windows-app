"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { recoverAction, type RecoveryState } from "./actions";

export type BackupChoice = { value: string; label: string; detail: string; encrypted: boolean };

export function RecoveryForm({ backups }: { backups: BackupChoice[] }) {
  const [state, action, pending] = useActionState<RecoveryState, FormData>(recoverAction, undefined);
  const [picked, setPicked] = useState(backups[0]?.value ?? "");
  if (state?.done) {
    return (
      <div className="flex flex-col gap-4" data-testid="recovered">
        <Notice tone="ok">
          Restored from {state.done.backup}, made {new Date(state.done.madeAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}. Anything entered after that is not in it.
        </Notice>
        <p className="m-0 text-sm text-neutral-700">
          The damaged database is kept, untouched, in <code className="break-all">{state.done.keptIn}</code>. Everyone signs in again.
        </p>
        <Link href="/login" className="inline-flex justify-center rounded-md bg-accent px-4 py-[11px] text-[15px] font-semibold text-accent-ink">
          Sign in
        </Link>
      </div>
    );
  }
  if (!backups.length) return null;
  const encrypted = backups.find((b) => b.value === picked)?.encrypted;
  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs text-fg/70">Backup to restore (newest first)</legend>
        {backups.map((b) => (
          <label key={b.value} className="flex items-start gap-2.5 rounded-md border border-line px-3 py-2 text-sm">
            <input type="radio" name="backup" value={b.value} checked={picked === b.value} onChange={() => setPicked(b.value)} className="mt-1 accent-accent" />
            <span>
              <strong>{b.label}</strong>
              <span className="block text-xs text-muted">{b.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Email of a Super Admin in that backup">
        <Input name="email" type="email" required autoComplete="username" defaultValue={state?.email} key={state?.email} />
      </Field>
      <Field label="Their password (as it was in the backup)">
        <Input name="password" type="password" required autoComplete="current-password" />
      </Field>
      {encrypted && (
        <Field label="The backup's password">
          <Input name="backupPassword" type="password" required autoComplete="off" />
        </Field>
      )}
      <Button variant="primary" disabled={pending} className="py-[11px] text-[15px]">
        {pending ? "Restoring…" : "Restore this backup"}
      </Button>
    </form>
  );
}
