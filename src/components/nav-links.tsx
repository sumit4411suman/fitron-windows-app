"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowsClockwiseIcon,
  BarbellIcon,
  BellIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  CalendarDotsIcon,
  ChartBarIcon,
  ClockCountdownIcon,
  FingerprintIcon,
  FunnelIcon,
  GearSixIcon,
  HandCoinsIcon,
  HandshakeIcon,
  IdentificationBadgeIcon,
  ListMagnifyingGlassIcon,
  LockSimpleIcon,
  ReceiptIcon,
  RepeatIcon,
  ScalesIcon,
  SparkleIcon,
  SquaresFourIcon,
  StorefrontIcon,
  TagIcon,
  UsersThreeIcon,
  WalletIcon,
  WhatsappLogoIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { NavGroup, NavIcon } from "@/lib/nav";
import { cx } from "./ui";

const ICONS: Record<NavIcon, Icon> = {
  dashboard: SquaresFourIcon,
  members: UsersThreeIcon,
  leads: FunnelIcon,
  renewals: ArrowsClockwiseIcon,
  attendance: CalendarCheckIcon,
  classes: CalendarDotsIcon,
  invoices: ReceiptIcon,
  payments: HandCoinsIcon,
  autopay: RepeatIcon,
  receivables: ClockCountdownIcon,
  pos: StorefrontIcon,
  expenses: WalletIcon,
  accounting: ScalesIcon,
  reports: ChartBarIcon,
  ai: SparkleIcon,
  whatsapp: WhatsappLogoIcon,
  programs: BarbellIcon,
  partnership: HandshakeIcon,
  notifications: BellIcon,
  plans: TagIcon,
  biometric: FingerprintIcon,
  staff: IdentificationBadgeIcon,
  audit: ListMagnifyingGlassIcon,
  settings: GearSixIcon,
  platform: BuildingsIcon,
};

const within = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function NavLinks({ groups, onNavigate, drawer }: { groups: NavGroup[]; onNavigate?: () => void; drawer?: boolean }) {
  const path = usePathname();
  // The most specific match wins, so /settings/devices lights up "Biometric & doors" rather than "Settings".
  const all = groups.flatMap((g) => g.items);
  const active = all
    .flatMap((i) => [i.href, ...(i.also ?? [])].filter((h) => within(path, h)).map((h) => ({ href: i.href, len: h.length })))
    .sort((a, b) => b.len - a.len)[0]?.href;
  return (
    <nav aria-label="Console sections" className="flex flex-col gap-[18px]">
      {groups.map((g) => (
        <div key={g.group} className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-[10px] tracking-[0.12em] text-faint uppercase">{g.group}</p>
          {g.items.map((i) => {
            const on = i.href === active;
            const I = ICONS[i.icon];
            return (
              <Link
                key={i.href}
                href={i.href}
                onClick={onNavigate}
                aria-current={on ? "page" : undefined}
                title={i.locked ? "Not in your plan yet. Tap to see plans." : undefined}
                className={cx(drawer ? "py-[11px] text-[15px]" : "py-[7px] text-sm", "flex items-center gap-2.5 rounded-md px-2 leading-[normal] hover:bg-accent-soft", on ? "bg-accent-soft text-accent-strong" : i.locked ? "text-muted" : "text-fg")}
              >
                <I size={drawer ? 19 : 18} weight="duotone" className="shrink-0" />
                <span className="flex-1">{i.label}</span>
                {i.locked && <LockSimpleIcon size={14} weight="duotone" className="shrink-0 text-muted" aria-label="Needs a bigger plan" />}
                {!!i.badge && !drawer && <span className="min-w-5 rounded-full bg-alert-soft px-1.5 py-px text-center text-[11px] text-alert-strong">{i.badge > 99 ? "99+" : i.badge}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
