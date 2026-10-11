"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/** The recovery key, shown once, with a print button and a confirmation before the console opens. */
export function RecoveryKey({ value }: { value: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <output aria-label="Recovery key" className="rounded-md border border-line bg-surface px-4 py-3 text-center font-mono text-xl tracking-[0.12em] select-all">
        {value}
      </output>
      <div className="flex gap-2 print:hidden">
        <Button type="button" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm print:hidden">
        <input type="checkbox" className="size-4" checked={saved} onChange={(ev) => setSaved(ev.target.checked)} /> I have saved the recovery key
      </label>
      <a
        href="/onboarding"
        aria-disabled={!saved}
        onClick={(ev) => !saved && ev.preventDefault()}
        className={`inline-flex justify-center rounded-md bg-accent px-4 py-[11px] text-[15px] font-semibold text-accent-ink print:hidden ${saved ? "" : "pointer-events-none opacity-45"}`}
      >
        Continue to FITRON
      </a>
    </div>
  );
}
