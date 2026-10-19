"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Notice } from "@/components/ui";
import { decideRec } from "./actions";

/** Accept, dismiss, defer or complete a recommendation: the owner's verdict, recorded with a note. */
export function RecommendationActions({ id, status, canAct }: { id: string; status: string; canAct: boolean }) {
  const [state, action, pending] = useActionState(decideRec.bind(null, id), undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, state?.nonce, router]);
  if (!canAct) return null;
  // Keyed on the response, so the open form closes after a successful save.
  return <Choice key={state?.nonce ?? "fresh"} status={status} state={state} action={action} pending={pending} />;
}

function Choice({ status, state, action, pending }: { status: string; state: Awaited<ReturnType<typeof decideRec>>; action: (fd: FormData) => void; pending: boolean }) {
  const [mode, setMode] = useState<"ACCEPTED" | "DISMISSED" | "DEFERRED" | "COMPLETED" | null>(null);
  const can = {
    ACCEPTED: status === "OPEN" || status === "DEFERRED",
    DISMISSED: status !== "COMPLETED",
    DEFERRED: status === "OPEN" || status === "ACCEPTED",
    COMPLETED: status === "ACCEPTED" || status === "OPEN",
  };
  const label = { ACCEPTED: "Accept", DISMISSED: "Dismiss", DEFERRED: "Defer", COMPLETED: "Mark completed" } as const;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(label) as (keyof typeof label)[]).map((k) =>
          can[k] ? (
            <Button key={k} type="button" variant={k === "ACCEPTED" ? "primary" : k === "DISMISSED" ? "danger" : "default"} onClick={() => setMode(mode === k ? null : k)}>
              {label[k]}
            </Button>
          ) : null,
        )}
      </div>
      {mode && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="status" value={mode} />
          <Field label={mode === "COMPLETED" ? "What was done" : "Note"} className="min-w-[260px] flex-1" error={state?.errors?.note}>
            <Input name="note" maxLength={500} placeholder={mode === "COMPLETED" ? "e.g. Called the six members; three paid" : "Why, in a line"} />
          </Field>
          {mode === "DEFERRED" && (
            <Field label="Until" error={state?.errors?.deferredUntil}>
              <Input type="date" name="deferredUntil" required />
            </Field>
          )}
          <Button variant="primary" disabled={pending}>
            {pending ? "Saving…" : `Confirm: ${label[mode].toLowerCase()}`}
          </Button>
          {state?.message && !state.ok && <Notice tone="alert">{state.message}</Notice>}
        </form>
      )}
      {mode === "COMPLETED" && <p className="m-0 text-[12px] text-muted">On completion the same figures are read again for the latest month and kept with the recommendation, so the outcome can be judged later.</p>}
    </div>
  );
}
