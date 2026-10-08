"use client";

import { useActionState, useState } from "react";
import { DownloadSimpleIcon, EraserIcon } from "@phosphor-icons/react";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";
import type { FormState } from "@/lib/validation/common";
import { eraseMemberAction, lookupForErase } from "./actions";

type Option = { id: string; label: string };
type Lookup = Awaited<ReturnType<typeof lookupForErase>>;

/** Settings › Privacy & DPDP › Member rights requests: export a member's data file, or erase a member who has left. */
export function PrivacyRequestForms({ options }: { options: Option[] }) {
  const [mode, setMode] = useState<"none" | "export" | "erase">("none");
  return (
    <div className="flex flex-col gap-3">
      <datalist id="pv-members">
        {options.map((o) => (
          <option key={o.id} value={o.label} />
        ))}
      </datalist>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="default" onClick={() => setMode(mode === "export" ? "none" : "export")}>
          <DownloadSimpleIcon size={16} weight="duotone" />
          Export a member&apos;s data
        </Button>
        <Button type="button" variant="ghost" className="text-alert-700 hover:bg-alert-soft" onClick={() => setMode(mode === "erase" ? "none" : "erase")}>
          <EraserIcon size={16} weight="duotone" />
          Erase a member&apos;s data
        </Button>
      </div>
      {mode === "export" && <ExportForm close={() => setMode("none")} />}
      {mode === "erase" && <EraseForm close={() => setMode("none")} />}
    </div>
  );
}

function ExportForm({ close }: { close: () => void }) {
  return (
    <form method="get" action="/settings/privacy/export" className="flex flex-col gap-2 rounded-md border border-line p-3 sm:flex-row sm:items-end">
      <Field label="Member ID" className="flex-1">
        <Input name="member" list="pv-members" placeholder="e.g. PHG-1001" required autoFocus />
      </Field>
      <div className="flex gap-2">
        <Button variant="default">
          <DownloadSimpleIcon size={16} weight="duotone" />
          Download
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EraseForm({ close }: { close: () => void }) {
  const [member, setMember] = useState("");
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<Lookup | null>(null);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState<FormState, FormData>(eraseMemberAction, undefined);
  const ready = found && !("error" in found);

  async function check() {
    setChecking(true);
    setFound(null);
    try {
      setFound(await lookupForErase(member));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      {!ready && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Member ID" className="flex-1">
            <Input name="member" list="pv-members" placeholder="e.g. PHG-1001" value={member} onChange={(e) => setMember(e.target.value)} required autoFocus />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="default" disabled={checking || !member.trim()} onClick={check}>
              {checking ? "Checking…" : "Continue"}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {found && "error" in found && <Notice tone="alert">{found.error}</Notice>}
      {ready && (
        <form action={action} className="flex flex-col gap-3.5 rounded-lg bg-surface p-5 shadow-lg">
          <input type="hidden" name="member" value={found.code} />
          <div>
            <div className="text-[11px] tracking-[0.1em] text-muted uppercase">Member rights · erasure</div>
            <div className="text-xl font-semibold">Erase personal data of {found.name}?</div>
          </div>
          <p className="m-0 text-[13px] text-muted">
            Name, phone, email, address, photo, documents, biometric data and messages are removed. Invoices and payments keep only the member ID, because tax law requires financial records to be kept. This cannot be undone.
          </p>
          {state?.message && <Notice tone="alert">{state.message}</Notice>}
          <Field label="Reason (recorded in the audit log) *" error={state?.errors?.reason}>
            <Textarea name="reason" required minLength={3} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2.5">
            <Button type="button" variant="ghost" onClick={close}>
              Keep it
            </Button>
            <Button variant="danger" disabled={pending || reason.trim().length < 3}>
              {pending ? "Erasing…" : "Erase personal data"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
