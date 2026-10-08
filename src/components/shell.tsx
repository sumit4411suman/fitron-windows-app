import Link from "next/link";
import type { ReactNode } from "react";
import { BellIcon, CrownSimpleIcon, HourglassMediumIcon } from "@phosphor-icons/react/dist/ssr";
import { cx } from "./ui";

/** The bar under the header while the gym is on trial or its plan has lapsed (prototype). */
export function TrialBanner({ alert, cta, children }: { alert: boolean; cta?: string; children: ReactNode }) {
  return (
    <div role="region" aria-label="Plan notice" className={cx("flex flex-wrap items-center justify-center gap-3 border-b px-4 py-2 text-[13px]", alert ? "border-alert/40 bg-alert-soft text-alert" : "border-accent/40 bg-accent-soft text-accent")}>
      <HourglassMediumIcon size={16} weight="duotone" />
      <span>{children}</span>
      {cta && (
        <Link href="/settings/billing" className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-ink hover:bg-accent-hover">
          <CrownSimpleIcon weight="duotone" />
          {cta}
        </Link>
      )}
    </div>
  );
}

export function BellLink({ unread }: { unread: number }) {
  return (
    <Link href="/notifications" className="relative grid size-9 place-items-center rounded-md hover:bg-fg/7" aria-label={unread ? `${unread} unread notifications` : "Notifications"}>
      <BellIcon size={20} weight="duotone" />
      {unread > 0 && <span className="absolute top-0.5 right-0 min-w-[17px] rounded-full bg-alert px-1 py-px text-center text-[10px] leading-tight text-bg">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}

