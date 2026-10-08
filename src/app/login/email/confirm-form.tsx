"use client";

import { useActionState } from "react";
import { confirmSignInLink } from "../actions";
import { Button, Notice } from "@/components/ui";

export function ConfirmLinkForm({ token, next }: { token: string; next: string }) {
  const [state, action, pending] = useActionState(confirmSignInLink, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="next" value={next} />
      <Button variant="primary" disabled={pending} className="py-[11px] text-[15px]">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
