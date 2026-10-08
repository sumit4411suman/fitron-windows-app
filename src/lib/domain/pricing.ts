// FITRON's public price list, from the pricing page on fitron.in. Paise, GST included.
// The pricing page (public/site) and this file must agree; pricing.test.ts checks the page.

export type Product = "AI_TRAINER" | "GYM_ACCOUNTING" | "PARTNER";
export type Cycle = "MONTHLY" | "YEARLY";

export type PlanDef = {
  key: string;
  product: Product;
  name: string;
  tagline: string;
  price: Record<Cycle, number>;
  /** Active-member cap for gym plans; null = unlimited. */
  memberLimit?: number | null;
  /** Gym plans: more than one branch allowed. */
  multiBranch?: boolean;
  trialDays: number;
  /** Gym plans: the card on the landing page's pricing section, word for word (pricing.test.ts checks the page). */
  card?: { audience: string; limit: string; includes?: string; features: readonly string[]; recommended?: boolean };
};

export const TRIAL_DAYS = 7;
/** Gym Partnership: the gym's share of what its linked members pay FITRON for the AI Trainer, of the price before GST (a payment's `base`). */
export const PARTNER_SHARE = 0.7;

export const PLANS = [
  { key: "ai-pro", product: "AI_TRAINER", name: "AI Pro", tagline: "Structured workouts and personalised fitness guidance.", price: { MONTHLY: 29_900, YEARLY: 1_99_900 }, trialDays: TRIAL_DAYS },
  { key: "ai-premium", product: "AI_TRAINER", name: "AI Premium", tagline: "Everything in AI Pro, with a higher daily AI Coach limit.", price: { MONTHLY: 49_900, YEARLY: 4_99_900 }, trialDays: TRIAL_DAYS },
  { key: "starter", product: "GYM_ACCOUNTING", name: "Starter", tagline: "For small gyms and fitness studios. Up to 100 active members.", price: { MONTHLY: 99_900, YEARLY: 9_99_000 }, memberLimit: 100, multiBranch: false, trialDays: TRIAL_DAYS,
    card: {
      audience: "For small gyms and fitness studios.",
      limit: "Up to 100 active members",
      features: ["Member registration and digital profiles", "Membership plans and renewal tracking", "Payment and outstanding fee management", "Revenue and expense recording", "Basic financial reports", "Membership expiry notifications", "Member data import and export"],
    } },
  { key: "professional", product: "GYM_ACCOUNTING", name: "Professional", tagline: "For growing gyms. Up to 300 active members.", price: { MONTHLY: 1_99_900, YEARLY: 19_99_000 }, memberLimit: 300, multiBranch: false, trialDays: TRIAL_DAYS,
    card: {
      audience: "For growing gyms.",
      limit: "Up to 300 active members",
      includes: "Everything in Starter, plus",
      features: ["Advanced accounting dashboard", "Monthly profit and loss reports", "Cash, UPI and payment tracking", "Automated WhatsApp payment reminders*", "Staff and trainer management", "Advanced expense categorisation", "Excel and CSV accounting exports", "AI Trainer integration for members"],
      recommended: true,
    } },
  { key: "enterprise", product: "GYM_ACCOUNTING", name: "Enterprise", tagline: "For large gyms and chains. Unlimited members, multi-branch.", price: { MONTHLY: 3_99_900, YEARLY: 39_99_000 }, memberLimit: null, multiBranch: true, trialDays: TRIAL_DAYS,
    card: {
      audience: "For large gyms, chains and multi-location businesses.",
      limit: "Unlimited members · multi-branch",
      includes: "Everything in Professional, plus",
      features: ["Unlimited member capacity", "Multi-branch management", "Consolidated financial reporting", "Branch-wise revenue and expenses", "Advanced staff roles and permissions", "Centralised management dashboard", "Advanced financial analytics", "Priority technical support"],
    } },
  { key: "partner-referral", product: "PARTNER", name: "Referral Partner", tagline: "Promote the AI Trainer and earn 70% of eligible subscriptions.", price: { MONTHLY: 99_900, YEARLY: 9_99_000 }, trialDays: 0 },
  { key: "partner-software", product: "PARTNER", name: "Software Partner", tagline: "Gym Accounting Professional plus 70% AI Trainer revenue share.", price: { MONTHLY: 1_99_900, YEARLY: 19_99_000 }, trialDays: 0 },
  { key: "partner-enterprise", product: "PARTNER", name: "Enterprise Partner", tagline: "Gym Accounting Enterprise plus 70% AI Trainer revenue share.", price: { MONTHLY: 3_99_900, YEARLY: 39_99_000 }, multiBranch: true, trialDays: 0 },
] as const satisfies readonly PlanDef[];

export type PlanKey = (typeof PLANS)[number]["key"];

export const DEFAULT_PLAN: PlanKey = "professional";

export function findPlan(key: string | null | undefined): PlanDef | undefined {
  return PLANS.find((p) => p.key === key);
}

export const PRODUCT_LABEL: Record<Product, string> = { AI_TRAINER: "AI Trainer", GYM_ACCOUNTING: "Gym Accounting", PARTNER: "Gym Partnership" };

/** "₹1,999" from paise, Indian digit grouping, no paise when whole. */
export function rupeesLabel(paise: number) {
  const r = paise / 100;
  return "₹" + r.toLocaleString("en-IN", { maximumFractionDigits: Number.isInteger(r) ? 0 : 2 });
}

/** The lowest Gym Accounting price for a billing cycle, in paise. */
export function lowestGymPrice(cycle: Cycle) {
  return Math.min(...PLANS.filter((p) => p.product === "GYM_ACCOUNTING").map((p) => p.price[cycle]));
}
