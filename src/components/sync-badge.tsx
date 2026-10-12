"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowsClockwiseIcon, CloudCheckIcon, CloudSlashIcon, WarningIcon } from "@phosphor-icons/react";

type Status = { linked: boolean; pending?: number; failed?: number; conflicts?: number; appliedSeq?: number; error?: string | null };

/**
 * FITRON for Windows, linked to fitron.in: a small badge in the header saying whether everything is in step, how many
 * changes wait to go up, or that the computer is offline. When changes from fitron.in arrive, the open page re-renders
 * with them (no reload, nothing typed is lost: a form keeps its values).
 */
export function SyncBadge() {
  const router = useRouter();
  const [s, setS] = useState<Status | null>(null);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/local/sync/status", { cache: "no-store" });
        if (!r.ok) return;
        const next = (await r.json()) as Status;
        if (!alive) return;
        setS(next);
        if (next.linked && typeof next.appliedSeq === "number") {
          if (seen.current !== null && next.appliedSeq > seen.current && !document.querySelector("form:focus-within")) router.refresh();
          seen.current = next.appliedSeq;
        }
      } catch {
        // The server is busy or closing: try again on the next tick.
      }
    };
    void read();
    const id = setInterval(read, 5_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [router]);
  if (!s?.linked) return null;
  const trouble = (s.failed ?? 0) + (s.conflicts ?? 0);
  const [Icon, text, tone] = s.error
    ? [CloudSlashIcon, s.error === "unlinked" ? "Not syncing" : s.pending ? `Offline · ${s.pending} waiting` : "Offline", "text-alert"]
    : trouble
      ? [WarningIcon, `${trouble} to check`, "text-alert"]
      : s.pending
        ? [ArrowsClockwiseIcon, `Syncing · ${s.pending}`, "text-muted"]
        : [CloudCheckIcon, "Synced", "text-muted"];
  return (
    <Link href="/settings/sync" className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs no-underline hover:bg-fg/5 ${tone}`} title="Cloud sync with fitron.in" data-testid="sync-badge">
      <Icon size={16} weight="duotone" aria-hidden />
      <span className="hidden sm:inline">{text}</span>
    </Link>
  );
}
