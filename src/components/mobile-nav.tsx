"use client";

import { useEffect, useState } from "react";
import { ListIcon } from "@phosphor-icons/react";
import type { NavGroup } from "@/lib/nav";
import { NavLinks } from "./nav-links";
import { SideLogo } from "./side-logo";
import { BranchSwitcher } from "./branch-switcher";

/** The bottom bar's Menu tab opens the drawer through this event. */
export const MENU_EVENT = "fitron:menu";

export function MobileNav({ groups, orgName, branchName, logo, branches, branch }: { groups: NavGroup[]; orgName: string; branchName: string; logo?: string | null; branches: { id: string; name: string }[]; branch: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const o = () => setOpen(true);
    window.addEventListener(MENU_EVENT, o);
    return () => window.removeEventListener(MENU_EVENT, o);
  }, []);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
      <button type="button" onClick={() => setOpen(true)} className="grid size-11 place-items-center rounded-md" aria-label="Menu" aria-expanded={open}>
        <ListIcon size={22} weight="duotone" />
      </button>
      <div className="min-w-0 flex-1 truncate text-[17px] font-semibold">
        {orgName} <span className="text-[13px] font-normal text-muted">{branchName}</span>
      </div>
      {open && (
        <div className="fixed inset-0 z-[70] bg-[color-mix(in_srgb,var(--neutral-900)_50%,transparent)]">
          <button type="button" aria-label="Close menu" className="absolute inset-0 cursor-default" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-[min(300px,86vw)] flex-col gap-[18px] overflow-y-auto bg-surface px-3.5 pb-[18px]">
            <span className="mt-4 -mb-1 block w-[190px] self-start">
              <SideLogo src={logo} name={orgName} />
            </span>
            <BranchSwitcher branches={branches} value={branch} drawer />
            <NavLinks groups={groups} onNavigate={() => setOpen(false)} drawer />
          </aside>
        </div>
      )}
    </div>
  );
}
