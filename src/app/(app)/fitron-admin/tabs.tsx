import Link from "next/link";
import { cx } from "@/components/ui";

export const ADMIN_TABS = [
  { href: "/fitron-admin", label: "Overview" },
  { href: "/fitron-admin/gyms", label: "Gyms" },
  { href: "/fitron-admin/trainer", label: "AI Trainer" },
  { href: "/fitron-admin/trainer?tab=payments", label: "AI Trainer payments" },
  { href: "/fitron-admin/trainer?tab=payouts", label: "Gym payouts" },
  { href: "/fitron-admin/trainer/content", label: "Form videos" },
  { href: "/fitron-admin/coupons", label: "Coupons" },
] as const;

/** The FITRON team's pages, as a tab row. */
export function AdminTabs({ current }: { current: string }) {
  return (
    <nav aria-label="Admin sections" className="mb-6 flex flex-wrap gap-1 border-b border-line">
      {ADMIN_TABS.map((t) => (
        <Link key={t.href} href={t.href} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", t.href === current ? "border-accent font-semibold" : "border-transparent text-muted hover:text-fg")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
