"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";

/**
 * Restore from a .fitronbackup chosen on this computer (Local Edition). The file goes to the server as the request body
 * (streamed to disk there, so a large backup is fine); the password and the typed RESTORE go with it.
 */
export function RestoreUpload() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Until the page's script has loaded, the form must not be sent the browser's own way (it would put the password in
  // the address): the button stays off until then.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a backup file.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/local/restore", {
        method: "POST",
        body: file,
        headers: {
          "content-type": "application/octet-stream",
          "x-fitron-password": encodeURIComponent(String(fd.get("password") ?? "")),
          "x-fitron-confirm": String(fd.get("confirm") ?? ""),
          "x-fitron-filename": encodeURIComponent(file.name),
        },
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; redirect?: string };
      if (body.ok && body.redirect) return window.location.assign(body.redirect);
      setError(body.error ?? "The restore did not finish. Nothing was changed.");
    } catch {
      setError("FITRON did not answer. Nothing was changed; try again.");
    }
    setBusy(false);
  }
  return (
    <form onSubmit={submit} method="post" className="flex flex-col gap-3.5">
      {error && <Notice tone="alert">{error}</Notice>}
      <Field label="Backup file (.fitronbackup)">
        <input type="file" name="file" accept=".fitronbackup" required className="text-sm" aria-label="Backup file" />
      </Field>
      <Field label="Backup password (if it has one)">
        <Input name="password" type="password" autoComplete="off" />
      </Field>
      <Field label="Type RESTORE to confirm">
        <Input name="confirm" autoComplete="off" required placeholder="RESTORE" />
      </Field>
      <Button variant="danger" disabled={busy || !ready}>
        {busy ? "Restoring… keep FITRON open" : "Restore"}
      </Button>
    </form>
  );
}
