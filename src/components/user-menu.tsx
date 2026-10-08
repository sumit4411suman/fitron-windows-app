"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/login/actions";
import { ChatCircleDotsIcon, ClockCounterClockwiseIcon, CompassIcon, CrownSimpleIcon, GearSixIcon, LockKeyIcon, MoonIcon, SignOutIcon, SunIcon, UserCircleIcon, type Icon } from "@phosphor-icons/react";
import { flipTheme } from "./theme-toggle";
import { TOUR_EVENT } from "./product-tour";
import { Avatar } from "./avatar";

type MenuUser = { name: string; email: string; role: string; branch: string; photo: string | null; canSettings: boolean; plan: string };

const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-[9px] text-left text-sm hover:bg-accent-soft";

function Item({ href, icon: I, label, onClick, badge }: { href: string; icon: Icon; label: string; onClick: () => void; badge?: string }) {
  return (
    <Link role="menuitem" href={href} onClick={onClick} className={item}>
      <I size={18} weight="duotone" className="text-accent" />
      <span className="flex-1">{label}</span>
      {badge && <span className="rounded-[10px] bg-accent-200 px-[7px] py-px text-[11px] text-accent">{badge}</span>}
    </Link>
  );
}

function Action({ icon: I, label, onClick }: { icon: Icon; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={item}>
      <I size={18} weight="duotone" className="text-accent" />
      {label}
    </button>
  );
}

export function UserMenu({ user }: { user: MenuUser }) {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setDark(document.documentElement.dataset.theme !== "light");
          setOpen((o) => !o);
        }}
        className="block rounded-full"
        title={user.name}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <Avatar name={user.name} src={user.photo} className="size-[34px] text-[13px]" />
      </button>
      {open && (
        <div role="menu" className="absolute top-[calc(100%+8px)] right-0 z-50 w-[280px] rounded-lg border border-line bg-surface p-2 shadow-lg">
          <div className="flex items-center gap-3 p-2.5">
            <Avatar name={user.name} src={user.photo} className="size-11" />
            <div className="min-w-0">
              <div className="truncate font-semibold">{user.name}</div>
              <div className="truncate text-xs text-muted">{user.email}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full border border-accent/50 px-[7px] py-px text-[11px] text-accent">{user.role}</span>
                <span className="text-[11px] text-muted">{user.branch}</span>
              </div>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Item href="/profile" icon={UserCircleIcon} label="My profile" onClick={close} />
          <Item href="/profile?tab=password" icon={LockKeyIcon} label="Change password" onClick={close} />
          {user.canSettings && <Item href="/settings/billing" icon={CrownSimpleIcon} label="Plan & billing" onClick={close} badge={user.plan} />}
          {user.canSettings && <Item href="/settings?tab=help" icon={ChatCircleDotsIcon} label="Contact Fitron support" onClick={close} />}
          <Action
            icon={CompassIcon}
            label="Product tour"
            onClick={() => {
              close();
              window.dispatchEvent(new Event(TOUR_EVENT));
            }}
          />
          <Action
            icon={dark ? SunIcon : MoonIcon}
            label={dark ? "Light mode" : "Dark mode"}
            onClick={() => {
              flipTheme();
              setDark((d) => !d);
            }}
          />
          {user.canSettings && <Item href="/settings" icon={GearSixIcon} label="Settings" onClick={close} />}
          <Item href="/profile#activity" icon={ClockCounterClockwiseIcon} label="My activity" onClick={close} />
          <div className="my-1 h-px bg-line" />
          <form action={logout}>
            <button role="menuitem" className={`${item} text-alert hover:bg-alert-soft`}>
              <SignOutIcon size={18} weight="duotone" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
