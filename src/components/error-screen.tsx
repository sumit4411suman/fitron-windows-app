"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error";
import { Button, LinkButton } from "@/components/ui";

/**
 * What a visitor sees when a page fails (src/app/error.tsx and src/app/(app)/error.tsx). The reference is the error's
 * digest: the same code is in the server log next to the failure, so a message to support that quotes it is enough to
 * find what happened.
 */
export function ErrorScreen({ error, retry, where, home }: { error: Error & { digest?: string }; retry: () => void; where: "page" | "app"; home: { href: string; label: string } }) {
  useEffect(() => {
    reportClientError(error, where);
    // A browser error right after an update is usually this tab still running the previous version's code: one fresh
    // load fixes it. Only once a minute, so a real bug shows this screen instead of reloading for ever.
    if (error.digest) return;
    try {
      const last = Number(sessionStorage.getItem(RELOADED_KEY));
      if (!shouldAutoReload(last, Date.now())) return;
      sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
    } catch {
      return; // no storage, no way to stop a loop: leave it to the Reload button
    }
    location.reload();
  }, [error, where]);
  return (
    <div role="alert" className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-16">
      <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">Something went wrong</p>
      <h1 className="text-3xl font-semibold sm:text-4xl">This page hit a problem on our side</h1>
      <p className="text-lg text-muted">Try again. If it keeps happening, tell us and quote the reference below, and we can find exactly what went wrong.</p>
      {error.digest ? (
        <p className="text-sm text-muted">
          Reference <code className="rounded border border-line bg-surface px-1.5 py-0.5 text-fg">{error.digest}</code>
        </p>
      ) : (
        // No digest: it failed in the browser, so there is no server log line to find. Its own message names what broke
        // (it is the browser's, not our data's), so show it for a screenshot to support.
        <p className="text-sm break-words text-muted">
          Details for support <code className="rounded border border-line bg-surface px-1.5 py-0.5 text-fg">{browserDetails(error)}</code>
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => retry()}>
          Try again
        </Button>
        <Button onClick={() => location.reload()}>Reload page</Button>
        <LinkButton href={home.href}>{home.label}</LinkButton>
        <LinkButton href="/contact?topic=support" variant="ghost">
          Contact support
        </LinkButton>
      </div>
    </div>
  );
}

/**
 * What failed in the browser, short enough to read on a phone, and where in the app's own code:
 * "TypeError: Cannot read properties of undefined @ chunks/0a1b2c.js:1:2345". The place is in the published files, which
 * a build of the same commit with source maps turns back into a line of our source.
 */
export function browserDetails(error: Error) {
  const what = `${error.name || "Error"}: ${String(error.message || "no message")}`.slice(0, 200);
  const at = String(error.stack ?? "").match(/\/_next\/static\/([^\s)]+:\d+:\d+)/)?.[1];
  return at ? `${what} @ ${at.slice(-80)}` : what;
}

const RELOADED_KEY = "fitron_error_reloaded_at";
const RELOAD_GAP_MS = 60_000;

/** Whether to reload by itself: not if it already did in the last minute (`last` is when, or 0/NaN for never). */
export const shouldAutoReload = (last: number, now: number) => !(last > 0 && now - last < RELOAD_GAP_MS);
