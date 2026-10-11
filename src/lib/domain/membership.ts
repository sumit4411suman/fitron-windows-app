import { daysBetween, type IsoDate } from "./dates";

export type MembershipStatus = "SUSPENDED" | "NO_PLAN" | "EXPIRED" | "UPCOMING" | "EXPIRING_SOON" | "PAYMENT_PENDING" | "ACTIVE";

export const EXPIRING_SOON_DAYS = 7;

/**
 * Rule 4: status comes from dates and balance, checked in this order.
 * `latestEnd` is the latest end date across the member's non-cancelled memberships; a member who was never sold
 * one is NO_PLAN (shown as "No plan"), not EXPIRED. For door access both are treated alike (access.ts entryBlock).
 * `current` says whether a membership covers today; when it is false and a plan still ends in the future, that plan
 * hasn't started yet and the member is UPCOMING ("Starts later"), not an active member. Left out, it isn't checked.
 */
export function membershipStatus(input: {
  suspended: boolean;
  latestEnd: IsoDate | null;
  outstanding: number;
  today: IsoDate;
  current?: boolean;
}): MembershipStatus {
  if (input.suspended) return "SUSPENDED";
  if (!input.latestEnd) return "NO_PLAN";
  const daysLeft = daysBetween(input.latestEnd, input.today);
  if (daysLeft < 0) return "EXPIRED";
  if (input.current === false) return "UPCOMING";
  if (daysLeft <= EXPIRING_SOON_DAYS) return "EXPIRING_SOON";
  if (input.outstanding > 0) return "PAYMENT_PENDING";
  return "ACTIVE";
}

/**
 * The plan to preselect when selling to a member without one: the first active plan of the gym's
 * default membership duration (Settings › Reminders). Plans come ordered status, months, price.
 */
/** A member's pricing-category hints, from the profile. */
export type PricingHints = { gender?: string | null; tags?: readonly string[] | null; occupation?: string | null };

/**
 * The plan price to preselect when selling: "Student" when a tag or the occupation says so and the plan has a
 * student price; else the price named after the member's gender; else "Standard". Staff can still change it.
 */
export function defaultPricingCategory(member: PricingHints, categories: readonly string[]): string {
  const has = (c: string) => categories.some((x) => x.toLowerCase() === c.toLowerCase());
  const student = [...(member.tags ?? []), member.occupation ?? ""].some((t) => /student/i.test(t));
  if (student && has("Student")) return categories.find((x) => x.toLowerCase() === "student")!;
  const g = (member.gender ?? "").trim().toLowerCase();
  if (g && has(g)) return categories.find((x) => x.toLowerCase() === g)!;
  return "Standard";
}

export function defaultPlanFor<T extends { id: string; months: number }>(plans: T[], defaultMonths: number): T | undefined {
  return plans.find((p) => p.months === defaultMonths);
}
