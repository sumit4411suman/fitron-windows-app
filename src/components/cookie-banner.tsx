"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CookieIcon } from "@phosphor-icons/react";
import { Button } from "./ui";

/**
 * The console's cookie choice, as in the prototype's banner. Stored in the `fitron_consent` cookie
 * ("all" or "essential") for a year: a per-viewer convenience, not gym data. The app has no analytics
 * today; anything added later must run only when `fitron_consent === "all"`.
 */
export const CONSENT_COOKIE = "fitron_consent";
const EVENT = "fitron:consent";

export const readConsent = () =>
  document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1) ?? null;

export function setConsent(choice: "all" | "essential" | null) {
  document.cookie = choice ? `${CONSENT_COOKIE}=${choice}; path=/; max-age=31536000; SameSite=Lax` : `${CONSENT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

/** Shown until a choice is made. Read on mount, so a decided viewer never sees it flash on refresh. */
export function CookieBanner() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => setOpen(readConsent() === null);
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  if (!open) return null;
  return (
    <div role="dialog" aria-label="Cookie choice" className="fixed inset-x-4 bottom-4 z-[130] mx-auto flex max-w-[560px] flex-col gap-3 rounded-2xl border border-[rgba(207,169,79,0.35)] bg-[#15130f] px-5 py-[18px] text-sm leading-[1.6] text-[#f3ede0] shadow-lg">
      <div className="flex items-start gap-2.5">
        <CookieIcon size={24} weight="duotone" className="shrink-0 text-[#cfa94f]" />
        <p className="m-0 flex-1">
          We use essential storage to keep you signed in and save your work. With your permission we also use analytics to improve Fitron. See the Privacy and Cookie notice in{" "}
          <Link href="/settings?tab=privacy#cookie-policy" className="text-[#f3ede0] no-underline">
            Settings
          </Link>
          .
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setConsent("essential")}>
          Essential only
        </Button>
        <Button type="button" variant="primary" onClick={() => setConsent("all")}>
          Accept all
        </Button>
      </div>
    </div>
  );
}

/** Settings › Privacy & DPDP: forgets the choice and shows the banner again, without a reload. */
export function ChangeCookieChoice() {
  return (
    <Button type="button" variant="ghost" className="-ml-2.5" onClick={() => setConsent(null)}>
      <CookieIcon size={16} weight="duotone" />
      Change cookie choice
    </Button>
  );
}
