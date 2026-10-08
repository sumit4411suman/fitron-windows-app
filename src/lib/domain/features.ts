// What each Gym Accounting plan opens in the console, from the cards on the landing page
// (src/lib/domain/pricing.ts). A gym on Starter sees the rest of the sidebar locked, with the plan
// that opens each section; nothing is hidden, so upgrading is one click from where they are.
import type { Permission } from "@/lib/auth/permissions";
import { findPlan } from "./pricing";

export type Feature =
  | "accounting"
  | "whatsapp"
  | "staff"
  | "attendance"
  | "classes"
  | "leads"
  | "pos"
  | "autopay"
  | "ai"
  | "programs"
  | "partnership"
  | "biometric"
  | "exports"
  | "analytics"
  | "roles";

export const FEATURES: Record<Feature, { label: string; card: string }> = {
  accounting: { label: "Accounting", card: "Advanced accounting dashboard, monthly profit and loss, purchases and fixed assets" },
  whatsapp: { label: "WhatsApp", card: "Automated WhatsApp payment reminders" },
  staff: { label: "Staff & roles", card: "Staff and trainer management" },
  attendance: { label: "Attendance", card: "Staff and trainer management" },
  classes: { label: "Classes", card: "Staff and trainer management" },
  leads: { label: "Leads & trials", card: "Staff and trainer management" },
  pos: { label: "POS & inventory", card: "Cash, UPI and payment tracking" },
  autopay: { label: "UPI autopay", card: "Cash, UPI and payment tracking" },
  ai: { label: "Fitron AI", card: "Advanced accounting dashboard" },
  programs: { label: "Workouts & diet", card: "AI Trainer integration for members" },
  partnership: { label: "Gym Partnership", card: "AI Trainer integration for members" },
  biometric: { label: "Biometric & doors", card: "Staff and trainer management" },
  exports: { label: "Excel exports", card: "Excel and CSV accounting exports" },
  analytics: { label: "Branch comparison", card: "Consolidated financial reporting and branch-wise revenue" },
  roles: { label: "Custom roles", card: "Advanced staff roles and permissions" },
};

const STARTER: Feature[] = [];
const PROFESSIONAL: Feature[] = [...STARTER, "accounting", "whatsapp", "staff", "attendance", "classes", "leads", "pos", "autopay", "ai", "programs", "partnership", "biometric", "exports"];
const ENTERPRISE: Feature[] = [...PROFESSIONAL, "analytics", "roles"];

/** Plan key → what it opens. Partner plans carry the gym plan they include. */
export const PLAN_FEATURES: Record<string, readonly Feature[]> = {
  starter: STARTER,
  professional: PROFESSIONAL,
  enterprise: ENTERPRISE,
  "partner-referral": STARTER,
  "partner-software": PROFESSIONAL,
  "partner-enterprise": ENTERPRISE,
};

/**
 * The plans whose cards promise priority support ("Priority technical support" on Enterprise, "Priority partner
 * support" on Enterprise Partner). Tickets from these gyms are marked as priority-plan for the support team
 * (src/lib/domain/support.ts); landing-page.test.ts keeps the cards and this list equal.
 */
export const PRIORITY_SUPPORT_PLANS: readonly string[] = ["enterprise", "partner-enterprise"];
export const hasPrioritySupport = (plan: { key: string; custom?: boolean }) => !plan.custom && PRIORITY_SUPPORT_PLANS.includes(plan.key);

/** The gym's plan as the console sees it. `custom` gyms (set up by hand, no trial) get everything. */
export type GymPlanView = { key: string; name: string; custom: boolean };

export function planHas(plan: GymPlanView, f: Feature) {
  if (plan.custom) return true;
  const list = PLAN_FEATURES[plan.key];
  // A plan key this build doesn't know (an old or renamed one) is never a reason to lock a paying gym out.
  return list ? list.includes(f) : true;
}

/** The cheapest plan that opens a feature, for the upgrade message. */
export function planFor(f: Feature) {
  const key = (["starter", "professional", "enterprise"] as const).find((k) => PLAN_FEATURES[k]!.includes(f)) ?? "enterprise";
  return { key, name: findPlan(key)?.name ?? key };
}

/**
 * Permissions whose pages belong to a plan feature. requirePermission checks the plan right after
 * the role, so every page and server action behind these keys is covered without touching each one.
 */
export const PERMISSION_FEATURE: Partial<Record<Permission, Feature>> = {
  "accounting.view": "accounting",
  "assets.manage": "accounting",
  "purchases.manage": "accounting",
  "months.lock": "accounting",
  "months.unlock": "accounting",
  "whatsapp.send": "whatsapp",
  "staff.manage": "staff",
  "payroll.manage": "staff",
  "attendance.manage": "attendance",
  "classes.manage": "classes",
  "leads.manage": "leads",
  "pos.sell": "pos",
  "products.manage": "pos",
  "autopay.manage": "autopay",
  "ai.use": "ai",
  "programs.manage": "programs",
};

/**
 * Whether this person may use a permission here: their role has it and, for the permissions in PERMISSION_FEATURE,
 * the gym's plan opens that section. Pages get this from requirePermission (src/lib/auth/current.ts); download
 * routes have no page layout in front of them, so they call this. A route that checked only `u.can(...)` let a
 * Starter gym download Professional exports by typing the address.
 */
export function canUsePermission(u: { can: (p: Permission) => boolean; has: (f: Feature) => boolean }, p: Permission) {
  const f = PERMISSION_FEATURE[p];
  return u.can(p) && (!f || u.has(f));
}
