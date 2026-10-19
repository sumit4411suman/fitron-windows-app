"use client";

import { useActionState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { FormState } from "@/lib/validation/common";
import { Button, Notice } from "./ui";

/**
 * A form bound to a server action that answers with FormState: shows the message, refills nothing (the fields are the
 * caller's), and refreshes the page on success so server-rendered figures update. `fields` gets the state so a field
 * can show its own error.
 */
export function ActionForm({ action: act, submit, variant = "primary", className, pendingLabel = "Working…", reset, children }: { action: (s: FormState, fd: FormData) => Promise<FormState>; submit: string; variant?: "primary" | "default" | "danger"; className?: string; pendingLabel?: string; /** Clear the form after success (default: keep). */ reset?: boolean; children: (state: FormState) => ReactNode }) {
  const [state, action, pending] = useActionState(act, undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, state?.nonce, router]);
  return (
    <form action={action} key={reset && state?.ok ? state.nonce : "form"} className={className ?? "flex flex-col gap-3"}>
      {children(state)}
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div>
        <Button variant={variant} disabled={pending}>
          {pending ? pendingLabel : submit}
        </Button>
      </div>
    </form>
  );
}

/** A one-button form (no fields): "Refresh", "Duplicate", "Accept". */
export function ActionButton({ action: act, label, variant = "default", confirm, className }: { action: (s: FormState, fd: FormData) => Promise<FormState>; label: string; variant?: "primary" | "default" | "danger" | "ghost"; confirm?: string; className?: string }) {
  const [state, action, pending] = useActionState(act, undefined);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, state?.nonce, router]);
  return (
    <form
      action={action}
      className={className ?? "inline-flex flex-col gap-2"}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <Button variant={variant} disabled={pending}>
        {pending ? "Working…" : label}
      </Button>
      {state?.message && !state.ok && <span className="text-xs text-alert">{state.message}</span>}
    </form>
  );
}
