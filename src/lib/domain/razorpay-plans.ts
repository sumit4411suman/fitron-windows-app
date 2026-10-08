// FITRON's auto-renewing plans in its own Razorpay account (Dashboard > Subscriptions > Plans, live mode).
// A Razorpay plan has a fixed amount, so the plan id decides what is charged: `amount` here is what that plan
// charges each period in paise, GST included, and a test keeps it equal to the price list (pricing.ts, saas.ts).
// Test mode has its own separate plans: with rzp_test_ keys the app finds or makes matching test plans itself (subscriptions.ts).
import type { Cycle } from "./pricing";

/** Razorpay stops after this many charges: 10 years of months, or 10 years of years. */
export const SUBSCRIPTION_CHARGES: Record<Cycle, number> = { MONTHLY: 120, YEARLY: 10 };

/** The key an extra branch has in this table (it is not a plan in pricing.ts). */
export const BRANCH_PLAN_KEY = "extra-branch";

export type RazorpayPlan = { id: string; amount: number };

/** Plan key (pricing.ts) -> billing cycle -> Razorpay plan. Partner plans and the extra branch exist monthly only. */
export const RAZORPAY_PLANS: Record<string, Partial<Record<Cycle, RazorpayPlan>>> = {
  // AI Trainer
  "ai-pro": { MONTHLY: { id: "plan_TkD9pDREcTR3NX", amount: 29_900 }, YEARLY: { id: "plan_TkDB0XsRqYQLi7", amount: 1_99_900 } },
  "ai-premium": { MONTHLY: { id: "plan_TkDBhXaK6dIWxm", amount: 49_900 }, YEARLY: { id: "plan_TkDC21kuHfIXCY", amount: 4_99_900 } },
  // Gym Accounting
  starter: { MONTHLY: { id: "plan_TkDCrneklKQL8n", amount: 99_900 }, YEARLY: { id: "plan_TkDDCjjXlnk6la", amount: 9_99_000 } },
  professional: { MONTHLY: { id: "plan_TkDDXb0qPjvxEO", amount: 1_99_900 }, YEARLY: { id: "plan_TkDEIlOqINlEsy", amount: 19_99_000 } },
  enterprise: { MONTHLY: { id: "plan_TkDEeIIkLfo4HX", amount: 3_99_900 }, YEARLY: { id: "plan_TkDEyN7YNsfplz", amount: 39_99_000 } },
  // Gym Partnership
  "partner-referral": { MONTHLY: { id: "plan_TkDFiDprKmhTAl", amount: 99_900 } },
  "partner-software": { MONTHLY: { id: "plan_TkDG4XSmAuXH57", amount: 1_99_900 } },
  "partner-enterprise": { MONTHLY: { id: "plan_TkDGSy4NXl76TI", amount: 3_99_900 } },
  // Add-on
  [BRANCH_PLAN_KEY]: { MONTHLY: { id: "plan_TkDH5pzzDQgwgw", amount: 49_900 } },
};

/** The Razorpay plan that auto-renews this plan (or the extra branch) for a cycle, or null when there is none (pay once instead). */
export const razorpayPlan = (key: string | null | undefined, cycle: string): RazorpayPlan | null => RAZORPAY_PLANS[key ?? ""]?.[cycle as Cycle] ?? null;

/** What a subscription pays for: a gym's Gym Accounting or partner plan, one extra branch, or an AI Trainer member's plan. */
export type SubscriptionKind = "GYM_PLAN" | "BRANCH" | "TRAINER";

/** Razorpay's states in which a subscription still renews (or is about to). "created" is a checkout nobody finished. */
export const RENEWING_STATUSES = ["authenticated", "active", "pending", "paused"] as const;
