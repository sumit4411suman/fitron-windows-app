"use client";

import { useActionState } from "react";
import { changeMemberPhoto } from "../actions";
import { Button, Notice } from "@/components/ui";

export function MemberPhotoForm({ memberId, hasPhoto }: { memberId: string; hasPhoto: boolean }) {
  const [state, action, pending] = useActionState(changeMemberPhoto.bind(null, memberId), undefined);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={action}>
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
            {pending ? "Saving…" : hasPhoto ? "Change photo" : "Upload photo"}
            <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={pending} onChange={(e) => e.currentTarget.files?.length && e.currentTarget.form?.requestSubmit()} />
          </label>
        </form>
        {hasPhoto && (
          <form action={action}>
            <Button variant="ghost" name="intent" value="remove" disabled={pending}>
              Remove
            </Button>
          </form>
        )}
        <span className="text-xs text-muted">JPG, PNG or WebP, up to 5 MB</span>
      </div>
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
    </div>
  );
}
