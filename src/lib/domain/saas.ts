// FITRON's own billing of gyms: the Gym Accounting plan (see pricing.ts), and extra branches
// paid monthly or yearly. Listed prices include GST: the customer pays exactly the listed price.
import { addDays, daysBetween, membershipEndDate, type IsoDate } from "./dates";
import { findPlan, PLANS } from "./pricing";

/** Branches included before extra-branch payments start. */
export const INCLUDED_BRANCHES = 3;
export const GRACE_DAYS = 7;
export const BRANCH_PRICE = { MONTHLY: 49_900, YEARLY: 4_99_000 } as const; // paise, GST included; "Additional gym branch" add-on
export const SAAS_GST_RATE = 18;
export type Cycle = keyof typeof BRANCH_PRICE;

/**
 * Splits a listed price (paise) into the taxable value and the GST inside it. The customer pays `total`, which is
 * the listed price itself; `base` is what is left after the 18% GST (listed / 1.18, rounded to the paisa).
 */
export function gstInside(listed: number) {
  const base = Math.round((listed * 100) / (100 + SAAS_GST_RATE));
  return { base, gst: listed - base, total: listed };
}

export const branchPrice = (cycle: Cycle) => gstInside(BRANCH_PRICE[cycle]);

/** A Gym Accounting or partner plan's price for one period: the listed price, with its GST worked out. */
export function planPrice(planKey: string, cycle: Cycle) {
  const p = findPlan(planKey);
  if (!p || (p.product !== "GYM_ACCOUNTING" && p.product !== "PARTNER")) throw new Error(`Not a gym plan: ${planKey}`);
  return gstInside(p.price[cycle]);
}

/** A paid period starts the day after the last one ends (or today, if it lapsed) and runs 1 or 12 months. */
export function nextPeriod(cycle: Cycle, today: IsoDate, lastEnd: IsoDate | null) {
  const start = lastEnd && lastEnd >= today ? addDays(lastEnd, 1) : today;
  return { start, end: membershipEndDate(start, cycle === "YEARLY" ? 12 : 1) };
}

export type Standing =
  | { kind: "INCLUDED" }
  | { kind: "PAID"; until: IsoDate }
  | { kind: "GRACE"; until: IsoDate; readOnlyFrom: IsoDate }
  | { kind: "READ_ONLY"; since: IsoDate | null }
  | { kind: "CLOSED" };

/**
 * Where each branch stands. The oldest `included` (3 unless the plan says otherwise) are included; every other branch needs a paid period.
 * After it ends there are 7 days' grace, then the branch is read-only: records stay, but no new
 * members or invoices until it is paid for again.
 */
export function standings(branches: { id: string; active?: boolean }[], paidUntil: Map<string, IsoDate>, today: IsoDate, included = INCLUDED_BRANCHES): Map<string, Standing> {
  const out = new Map<string, Standing>();
  let seat = 0;
  branches.forEach((b) => {
    if (b.active === false) return out.set(b.id, { kind: "CLOSED" });
    if (seat++ < included) return out.set(b.id, { kind: "INCLUDED" });
    const until = paidUntil.get(b.id) ?? null;
    if (until && until >= today) return out.set(b.id, { kind: "PAID", until });
    const readOnlyFrom = until ? addDays(until, GRACE_DAYS + 1) : null;
    if (until && readOnlyFrom! > today) return out.set(b.id, { kind: "GRACE", until, readOnlyFrom: readOnlyFrom! });
    out.set(b.id, { kind: "READ_ONLY", since: readOnlyFrom });
  });
  return out;
}

/** Intra-state supply (same GST state code as Fitron) is CGST + SGST; otherwise IGST. */
export function gstSplit(fitronGstin: string, buyerGstin: string | null | undefined, gst: number) {
  const same = !!buyerGstin && !!fitronGstin && buyerGstin.slice(0, 2) === fitronGstin.slice(0, 2);
  return same ? { type: "CGST_SGST" as const, cgst: Math.floor(gst / 2), sgst: gst - Math.floor(gst / 2), igst: 0 } : { type: "IGST" as const, cgst: 0, sgst: 0, igst: gst };
}

/** What a gym may do on its plan. Gyms set up by hand (no trial date) keep the original rules: no member cap, 3 branches. */
export type GymTerms = { custom: boolean; memberLimit: number | null; includedBranches: number; extraBranches: boolean };

export function gymTerms(org: { plan: string; trialEndsAt: Date | null }): GymTerms {
  if (!org.trialEndsAt) return { custom: true, memberLimit: null, includedBranches: INCLUDED_BRANCHES, extraBranches: true };
  const p = findPlan(org.plan);
  const multi = p?.multiBranch ?? false;
  return { custom: false, memberLimit: p?.memberLimit ?? null, includedBranches: multi ? INCLUDED_BRANCHES : 1, extraBranches: multi };
}

export type PlanStanding =
  | { kind: "CUSTOM" }
  | { kind: "TRIAL"; until: IsoDate }
  | { kind: "PAID"; until: IsoDate }
  | { kind: "GRACE"; until: IsoDate; readOnlyFrom: IsoDate }
  | { kind: "LAPSED"; since: IsoDate };

/**
 * Where a self-signed-up gym stands. The trial runs to its end date; a paid period is followed by
 * 7 days' grace. After that the gym is read-only: everything stays, but no new members or invoices.
 */
export function planStanding(trialEnd: IsoDate | null, paidUntil: IsoDate | null, today: IsoDate): PlanStanding {
  if (!trialEnd) return { kind: "CUSTOM" };
  if (paidUntil && paidUntil >= today) return { kind: "PAID", until: paidUntil };
  if (paidUntil) {
    const readOnlyFrom = addDays(paidUntil, GRACE_DAYS + 1);
    if (readOnlyFrom > today) return { kind: "GRACE", until: paidUntil, readOnlyFrom };
    return { kind: "LAPSED", since: readOnlyFrom };
  }
  if (trialEnd >= today) return { kind: "TRIAL", until: trialEnd };
  return { kind: "LAPSED", since: addDays(trialEnd, 1) };
}

export const planWritable = (s: PlanStanding) => s.kind !== "LAPSED";

/** The Gym Accounting plans as the landing page shows them, with what each costs to pay (GST included). */
export const gymPlanCards = () =>
  PLANS.filter((p) => p.product === "GYM_ACCOUNTING").map((p) => ({
    key: p.key,
    name: p.name,
    price: { MONTHLY: p.price.MONTHLY, YEARLY: p.price.YEARLY },
    total: { MONTHLY: planPrice(p.key, "MONTHLY").total, YEARLY: planPrice(p.key, "YEARLY").total },
    card: p.card!,
  }));

// ── Settings › Subscription: renewal reminders and billing details ─────────

export const REMIND_DAYS = [14, 7, 3, 1] as const;
export type RemindDays = (typeof REMIND_DAYS)[number];

/** Setting "subscription": when to remind, on which channels, and what the FITRON receipts print. */
export type SubscriptionSettings = {
  remindDays: RemindDays;
  whatsapp: boolean;
  email: boolean;
  legalName: string;
  gstin: string;
  billingEmail: string;
  address: string;
};

export const DEFAULT_SUBSCRIPTION: SubscriptionSettings = { remindDays: 7, whatsapp: true, email: true, legalName: "", gstin: "", billingEmail: "", address: "" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-04" → "4 Oct 2026", for reminder texts (no React here). */
export const longDate = (d: IsoDate) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

export type RenewalReminder = { kind: "DUE" | "GRACE" | "LAPSED"; daysLeft: number; until: IsoDate; text: string };

const dayWord = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * The plan reminder to send today, if any: `remindDays` before the trial or paid period ends and
 * again the day before (so remindDays 1 fires once), on the first day of grace, and on the day the
 * gym turns read-only. Nothing for gyms FITRON set up by hand.
 */
export function renewalReminder(s: PlanStanding, planName: string, today: IsoDate, remindDays: number): RenewalReminder | null {
  if (s.kind === "CUSTOM") return null;
  const fire = new Set([remindDays, 1]);
  if (s.kind === "TRIAL") {
    const daysLeft = daysBetween(s.until, today) + 1; // the sign-up day counts
    if (!fire.has(daysLeft)) return null;
    return { kind: "DUE", daysLeft, until: s.until, text: `Your FITRON free trial ends in ${dayWord(daysLeft)} (${longDate(s.until)}). Choose a plan to keep adding members and invoices.` };
  }
  if (s.kind === "PAID") {
    const daysLeft = daysBetween(s.until, today);
    if (!fire.has(daysLeft)) return null;
    return { kind: "DUE", daysLeft, until: s.until, text: `Your ${planName} plan ends in ${dayWord(daysLeft)} (${longDate(s.until)}). Renew to keep everything running.` };
  }
  if (s.kind === "GRACE") {
    if (s.until !== addDays(today, -1)) return null;
    return { kind: "GRACE", daysLeft: 0, until: s.until, text: `Your ${planName} plan has ended. The gym becomes read-only on ${longDate(s.readOnlyFrom)} unless renewed.` };
  }
  if (s.since !== today) return null;
  return { kind: "LAPSED", daysLeft: 0, until: s.since, text: "Your FITRON plan has ended and the gym is now read-only. Your records are safe; renew to switch it back on." };
}

/** "Your Professional plan ends in 7 days (4 Oct 2026). Renew…" → "your Professional plan ends in 7 days", for an email subject. */
export function reminderSubject(text: string) {
  const first = text.split(/\.\s/)[0]!.replace(/\s*\([^)]*\)/g, "").replace(/\.$/, "");
  return `FITRON: ${first.charAt(0).toLowerCase()}${first.slice(1)}`;
}
