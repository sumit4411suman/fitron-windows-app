"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDotsIcon, DoorOpenIcon, HandCoinsIcon, HouseIcon, ListIcon, PlusIcon, UsersIcon, type Icon } from "@phosphor-icons/react";
import { MENU_EVENT } from "./mobile-nav";

type Tab = { label: string; icon: Icon; href?: string; big?: boolean };

/** The phone's bottom bar (prototype): Home, Members, a gold Add, Collect and Menu. Hidden from the desktop width up. */
export function MobileTabBar({ canMembers, canAdd, canCollect, home, homeLabel }: { canMembers: boolean; canAdd: boolean; canCollect: boolean; home: string; homeLabel: string }) {
  const path = usePathname();
  const tabs: Tab[] = [
    { label: homeLabel, icon: HouseIcon, href: home },
    canMembers ? { label: "Members", icon: UsersIcon, href: "/members" } : { label: "Check-in", icon: DoorOpenIcon, href: "/attendance" },
    canAdd ? { label: "Add", icon: PlusIcon, href: "/members/new", big: true } : { label: "Check-in", icon: DoorOpenIcon, href: "/attendance", big: true },
    canCollect ? { label: "Collect", icon: HandCoinsIcon, href: "/receivables" } : { label: "Classes", icon: CalendarDotsIcon, href: "/classes" },
    { label: "Menu", icon: ListIcon },
  ];
  const cell = "flex min-h-12 flex-col items-center gap-0.5 bg-transparent px-0 py-1 text-[11px]";
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-[60] grid grid-cols-5 border-t border-line bg-surface px-1 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] lg:hidden print:hidden">
      {tabs.map((t, i) => {
        const on = !!t.href && !t.big && (path === t.href || path.startsWith(t.href + "/"));
        const inner = (
          <>
            <span className={`grid place-items-center rounded-full ${t.big ? "size-10 bg-accent text-[#15120b]" : "size-7"}`}>
              <t.icon size={22} weight="duotone" />
            </span>
            {t.label}
          </>
        );
        const color = on ? "text-accent" : "text-neutral-700";
        return t.href ? (
          <Link key={i} href={t.href} aria-label={t.label} className={`${cell} ${color}`}>
            {inner}
          </Link>
        ) : (
          <button key={i} type="button" aria-label={t.label} onClick={() => window.dispatchEvent(new Event(MENU_EVENT))} className={`${cell} ${color}`}>
            {inner}
          </button>
        );
      })}
    </nav>
  );
}
