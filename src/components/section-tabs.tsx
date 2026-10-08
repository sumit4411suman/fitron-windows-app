import type { ReactNode } from "react";
import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/current";
import type { Permission } from "@/lib/auth/permissions";
import { cx } from "./ui";

type Tab = { href: string; label: string; perm?: Permission };

/** Underlined tabs across the top of a section, as in the prototype's Accounting and Settings. */
export function SectionTabs({ u, tabs, current, className = "mb-6", ruled, label = "Page sections" }: { u: CurrentUser; tabs: Tab[]; current: string; className?: string; ruled?: boolean; label?: string }) {
  const shown = tabs.filter((t) => !t.perm || u.can(t.perm));
  if (shown.length < 2) return null;
  return (
    <nav aria-label={label} className={cx("flex flex-wrap", ruled ? "gap-0.5 border-b border-line" : "gap-1", className)}>
      {shown.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={cx("border-b-2 px-3 py-2 text-[15px]", ruled && "flex-none leading-[normal] whitespace-nowrap", t.href === current ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** The prototype's Settings frame: "Super Admin" kicker, 40px title, ruled tabs, then the tab's content. */
export function SettingsShell({ u, current, children }: { u: CurrentUser; current: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-7 pt-4">
      <div>
        <div className="text-[11px] tracking-[0.1em] text-muted uppercase">{u.role}</div>
        <h1 className="mt-1 text-[28px] lg:text-[40px]">Settings</h1>
      </div>
      <div className="-mb-7">
        <SectionTabs u={u} tabs={SETTINGS_TABS} current={current} ruled />
      </div>
      {children}
    </div>
  );
}

export const ACCOUNTING_TABS: Tab[] = [
  { href: "/accounting", label: "Profit & loss", perm: "accounting.view" },
  { href: "/purchases", label: "Purchases", perm: "purchases.manage" },
  { href: "/assets", label: "Fixed assets", perm: "assets.manage" },
  { href: "/accounting?tab=ledger", label: "Ledgers", perm: "accounting.view" },
  { href: "/accounting?tab=close", label: "Month-end closing", perm: "accounting.view" },
];

export const SETTINGS_TABS: Tab[] = [
  { href: "/settings", label: "Gym profile" },
  { href: "/settings?tab=billing", label: "Billing & GST" },
  { href: "/settings?tab=reminders", label: "Reminders" },
  { href: "/settings?tab=wa", label: "WhatsApp" },
  { href: "/settings?tab=int", label: "Integrations & AI" },
  { href: "/settings/import", label: "Migrate & import", perm: "import.run" },
  { href: "/settings/backup", label: "Backup" },
  { href: "/settings/go-live", label: "Go live" },
  { href: "/settings/billing", label: "Subscription" },
  { href: "/settings?tab=branches", label: "Branches" },
  { href: "/settings/roles", label: "Roles & access", perm: "staff.manage" },
  { href: "/settings?tab=privacy", label: "Privacy & DPDP" },
  { href: "/settings?tab=help", label: "Help & support" },
];
