import type { Permission } from "@/lib/auth/permissions";
import type { Feature } from "@/lib/domain/features";
import type { NavCounts } from "@/lib/services/shell";

export type NavIcon =
  | "dashboard"
  | "members"
  | "leads"
  | "renewals"
  | "attendance"
  | "classes"
  | "invoices"
  | "payments"
  | "autopay"
  | "receivables"
  | "pos"
  | "expenses"
  | "accounting"
  | "reports"
  | "ai"
  | "whatsapp"
  | "programs"
  | "partnership"
  | "notifications"
  | "plans"
  | "biometric"
  | "staff"
  | "audit"
  | "settings"
  /** The FITRON team console; added by the layout for FITRON_ADMIN_EMAILS only. */
  | "platform";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  perm?: Permission;
  /** Visible when the person has any of these. */
  anyPerm?: Permission[];
  /** The plan feature this section needs (src/lib/domain/features.ts); locked on plans without it. */
  feature?: Feature;
  /** Set by the layout when the gym's plan doesn't open this section: shown with a lock, leads to the plans. */
  locked?: boolean;
  /** Other pages that belong to this section, so it stays highlighted there. */
  also?: string[];
  /** Which sidebar number to show (the prototype's badge counts). */
  count?: keyof NavCounts;
  badge?: number;
};
export type NavGroup = { group: string; items: NavItem[] };

// The prototype's sidebar (prototype/fitron-core.js): same groups, labels, icons and order.
export const NAV: NavGroup[] = [
  {
    group: "Front desk",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/members", label: "Members", icon: "members", perm: "members.view" },
      { href: "/leads", label: "Leads & trials", icon: "leads", perm: "leads.manage", feature: "leads", count: "leads" },
      { href: "/renewals", label: "Renewals", icon: "renewals", perm: "memberships.renew", count: "renewals" },
      { href: "/attendance", label: "Attendance", icon: "attendance", perm: "attendance.manage", feature: "attendance" },
      { href: "/classes", label: "Classes", icon: "classes", perm: "classes.manage", feature: "classes" },
    ],
  },
  {
    group: "Billing",
    items: [
      { href: "/invoices", label: "Invoices", icon: "invoices", perm: "invoices.view" },
      { href: "/payments", label: "Payments", icon: "payments", perm: "invoices.view" },
      { href: "/autopay", label: "UPI autopay", icon: "autopay", perm: "autopay.manage", feature: "autopay" },
      { href: "/receivables", label: "Receivables", icon: "receivables", perm: "invoices.view", count: "receivables" },
      { href: "/pos", label: "POS & inventory", icon: "pos", perm: "pos.sell", feature: "pos", also: ["/products"] },
    ],
  },
  {
    group: "Accounts",
    items: [
      { href: "/expenses", label: "Expenses", icon: "expenses", perm: "expenses.manage" },
      { href: "/accounting", label: "Accounting", icon: "accounting", perm: "accounting.view", feature: "accounting", also: ["/purchases", "/assets"] },
      { href: "/reports", label: "Reports", icon: "reports", perm: "invoices.view" },
    ],
  },
  {
    group: "Engage",
    items: [
      { href: "/ai", label: "Fitron AI", icon: "ai", perm: "ai.use", feature: "ai", count: "ai" },
      { href: "/whatsapp", label: "WhatsApp", icon: "whatsapp", perm: "whatsapp.send", feature: "whatsapp" },
      { href: "/programs", label: "Workouts & diet", icon: "programs", perm: "programs.manage", feature: "programs" },
      { href: "/partnership", label: "Gym Partnership", icon: "partnership", perm: "accounting.view", feature: "partnership" },
      { href: "/notifications", label: "Notifications", icon: "notifications", count: "notifications" },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/plans", label: "Plans & offers", icon: "plans", perm: "plans.manage" },
      { href: "/settings/devices", label: "Biometric & doors", icon: "biometric", perm: "settings.manage", feature: "biometric" },
      { href: "/staff", label: "Staff & roles", icon: "staff", anyPerm: ["staff.manage", "payroll.manage"], feature: "staff" },
      { href: "/audit", label: "Audit log", icon: "audit", perm: "audit.view" },
      { href: "/settings", label: "Settings", icon: "settings", perm: "settings.manage" },
    ],
  },
];

/** Whether this person may open a page, by the sidebar item it belongs to (so links never lead to "not allowed" or a locked section). */
export function canOpen(u: { can: (p: Permission) => boolean; has: (f: Feature) => boolean }, href: string) {
  const path = href.split(/[?#]/)[0]!;
  for (const g of NAV)
    for (const i of g.items) {
      const roots = [i.href, ...(i.also ?? [])];
      if (roots.some((r) => path === r || path.startsWith(`${r}/`))) return (!i.perm || u.can(i.perm)) && (!i.anyPerm || i.anyPerm.some((p) => u.can(p))) && (!i.feature || u.has(i.feature));
    }
  return true;
}
