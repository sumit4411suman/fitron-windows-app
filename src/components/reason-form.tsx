"use client";

import { useActionState, useCallback, useState } from "react";
import { Modal } from "./confirm-dialog";
import { Button, Field, Input, Notice } from "./ui";

type Result = { ok?: boolean; message?: string; errors?: Record<string, string[] | undefined> } | undefined;

/**
 * A danger button that asks for a reason before running an irreversible-looking action. The question and the reason
 * field open in the app's own modal over the page, so a button in the last column of a wide table never opens a
 * field out of sight, and no browser box is needed to confirm.
 */
export function ReasonForm({ action: act, label, confirm, done, compact }: { action: (s: Result, fd: FormData) => Promise<Result>; label: string; confirm: string; done?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(act, undefined);
  const close = useCallback(() => setOpen(false), []);
  if (state?.ok) return <Notice tone="ok">{state.message}</Notice>;
  if (done) return null;
  return (
    <>
      <Button type="button" variant={compact ? "ghost" : "danger"} className={compact ? "text-alert-700 hover:bg-alert-soft" : undefined} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <Modal title={confirm} onClose={close}>
          <form action={action} className="flex flex-col gap-3">
            <Field label="Reason" error={state?.errors?.reason}>
              <Input name="reason" required minLength={3} />
            </Field>
            {state?.message && <Notice tone="alert">{state.message}</Notice>}
            <div className="flex justify-end gap-2.5">
              <Button type="button" onClick={close}>
                Keep
              </Button>
              <Button variant="danger" disabled={pending}>
                {pending ? "Working…" : label}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
