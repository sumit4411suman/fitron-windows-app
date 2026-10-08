"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";

// The cookie choice of the public pages. It is the same choice the home page's banner stores (localStorage
// `fitron-site-consent`: { choice, analytics, preferences, at }), so a visitor is asked once for the whole website.
// Analytics (public/site/analytics.js) runs only when `analytics` is true. No advertising cookies are used.

const KEY = "fitron-site-consent";
const OPEN = "fitron:cookie-settings";

type Choice = { choice: "all" | "essential" | "custom"; analytics: boolean; preferences: boolean };

const read = (): Choice | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
};

function save(c: Choice) {
  const v = { ...c, at: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Storage is blocked: the choice lasts until the page is left.
  }
  window.dispatchEvent(new CustomEvent("fitron:consent", { detail: v }));
}

export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN))}>
      Cookie settings
    </button>
  );
}

export function SiteConsent() {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [preferences, setPreferences] = useState(false);

  useEffect(() => {
    // Not at once: the banner is the biggest block of text on a short page, and as the first thing painted it would be the page's
    // Largest Contentful Paint. Waiting a moment lets the page's own content be that. Nothing runs before a choice, so nothing is lost.
    const first = setTimeout(() => setOpen(read() === null), 2500);
    const reopen = () => {
      const c = read();
      setAnalytics(!!c?.analytics);
      setPreferences(!!c?.preferences);
      setManage(true);
      setOpen(true);
    };
    window.addEventListener(OPEN, reopen);
    return () => {
      clearTimeout(first);
      window.removeEventListener(OPEN, reopen);
    };
  }, []);

  const choose = (c: Choice) => {
    save(c);
    setOpen(false);
    setManage(false);
  };

  if (!open) return null;
  return (
    <div role="dialog" aria-label="Cookie consent" className="s-card s-solid fixed inset-x-3 bottom-3 z-[55] mx-auto flex max-h-[85vh] max-w-3xl flex-col gap-3 overflow-y-auto p-4 shadow-lg sm:p-5">
      <p className="text-sm text-muted">
        <b className="block text-fg">Cookies and your data</b>
        We use essential cookies to run fitron.in. With your consent we also remember your preferences and use analytics (Google Analytics) to count how the site is used. No advertising cookies.{" "}
        <a href="/privacy#cookies" className="underline">
          Cookie Policy
        </a>{" "}
        ·{" "}
        <a href="/privacy" className="underline">
          Privacy Policy
        </a>
      </p>
      {manage && (
        <div className="grid gap-3 border-t border-line pt-3 text-sm text-muted">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked disabled className="mt-1 size-5 accent-[var(--accent)]" />
            <span>
              <b className="block text-fg">Essential</b>Keep the site working and remember this choice. Always on.
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={preferences} onChange={(e) => setPreferences(e.target.checked)} className="mt-1 size-5 accent-[var(--accent)]" />
            <span>
              <b className="block text-fg">Preferences</b>Remember small choices such as the pricing tab you last looked at.
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="mt-1 size-5 accent-[var(--accent)]" />
            <span>
              <b className="block text-fg">Analytics</b>Counts of which pages and buttons are used, with Google Analytics, so we can improve the site.
            </span>
          </label>
          <p>Advertising cookies: none are used.</p>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="s-btn s-btn-ghost s-btn-sm" onClick={() => choose({ choice: "essential", analytics: false, preferences: false })}>
          Essential only
        </button>
        {manage ? (
          <button type="button" className="s-btn s-btn-ghost s-btn-sm" onClick={() => choose({ choice: "custom", analytics, preferences })}>
            Save choices
          </button>
        ) : (
          <button type="button" className="s-btn s-btn-ghost s-btn-sm" aria-expanded={false} onClick={() => setManage(true)}>
            Manage settings
          </button>
        )}
        <button type="button" className="s-btn s-btn-primary s-btn-sm" onClick={() => choose({ choice: "all", analytics: true, preferences: true })}>
          Accept all
        </button>
      </div>
    </div>
  );
}

// Pages that carry a secret in their address (a password-reset or e-mail verification link) never load analytics,
// whatever the visitor chose.
const NO_ANALYTICS = ["/reset-password", "/verify-email", "/forgot-password", "/signup"];

export function SiteAnalytics() {
  const pathname = usePathname();
  if (NO_ANALYTICS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  return <Script src="/site/analytics.js" strategy="afterInteractive" />;
}
