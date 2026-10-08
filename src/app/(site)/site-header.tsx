"use client";

import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";

// The header of every public page: the same links as the home page, sticky, a little shorter once you scroll, and a
// full-screen menu on phones. Plain <a> links: the home page is a static file, not a route.

export const NAV_LINKS = [
  ["/ai-personal-trainer", "AI Trainer"],
  ["/gym-accounting", "Gym Accounting"],
  ["/#together", "Better Together"],
  ["/#partnership", "Partner With Us"],
  ["/#pricing", "Pricing"],
  ["/#faq", "FAQ"],
] as const;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 20);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  // Open menu: the page behind does not scroll, Escape closes it, and focus goes in and comes back.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menu.current?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab" && menu.current) {
        const items = [...menu.current.querySelectorAll<HTMLElement>("a,button")];
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };

  return (
    <>
      <header className={`sticky top-0 z-50 border-b border-line bg-bg/85 backdrop-blur-md transition-[padding] ${scrolled ? "py-2" : "py-4"}`}>
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4">
          <a href="/" aria-label="FITRON home" className="shrink-0">
            <Logo size={scrolled ? 28 : 32} />
          </a>
          <nav aria-label="Main" className="hidden items-center gap-5 xl:flex">
            {NAV_LINKS.map(([href, label]) => (
              <a key={href} href={href} className="s-nav-link">
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <a href="/signin" data-track="signin_click" data-track-from="header" className="s-nav-link hidden min-h-11 items-center px-1 min-[340px]:inline-flex">
              Sign in
            </a>
            <a href="/#products" data-track="get_started_click" data-track-from="header" className="s-btn s-btn-primary s-btn-sm">
              Get Started
            </a>
            <button
              ref={button}
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => (open ? close() : setOpen(true))}
              className="inline-flex size-11 items-center justify-center rounded-full border border-line xl:hidden"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>
      </header>
      {open && (
        <div id="site-menu" ref={menu} role="dialog" aria-modal="true" aria-label="Menu" className="s-menu xl:hidden">
          <button type="button" aria-label="Close menu" onClick={close} className="absolute top-4 right-4 inline-flex size-11 items-center justify-center rounded-full border border-line">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {[...NAV_LINKS, ["/contact", "Contact"] as const].map(([href, label]) => (
            <a key={href} href={href} className="s-menu-link" onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/signin" data-track="signin_click" data-track-from="menu" className="s-btn s-btn-ghost" onClick={() => setOpen(false)}>
              Sign In
            </a>
            <a href="/#products" data-track="get_started_click" data-track-from="menu" className="s-btn s-btn-primary" onClick={() => setOpen(false)}>
              Get Started
            </a>
          </div>
        </div>
      )}
    </>
  );
}
