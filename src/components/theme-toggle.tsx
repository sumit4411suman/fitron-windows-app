"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";

/** Dark is the default; this flips to light and back, and remembers the choice in this browser. */
export function flipTheme() {
  {
    const root = document.documentElement;
    const light = root.dataset.theme !== "light";
    if (light) root.dataset.theme = "light";
    else delete root.dataset.theme;
    try {
      localStorage.setItem("fitron_theme", light ? "light" : "dark");
    } catch {
      // Private mode: the choice lasts until the page reloads.
    }
  }
}

export function ThemeToggle() {
  const flip = flipTheme;
  return (
    <button type="button" onClick={flip} title="Light or dark theme" aria-label="Switch between light and dark theme" className="grid size-9 place-items-center rounded-md hover:bg-fg/7">
      <SunIcon size={20} weight="duotone" className="light:hidden" />
      <MoonIcon size={20} weight="duotone" className="hidden light:block" />
    </button>
  );
}
