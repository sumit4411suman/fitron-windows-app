import { daysBetween, type IsoDate } from "./dates";

export type MembershipStatus = "SUSPENDED" | "EXPIRED" | "EXPIRING_SOON" | "PAYMENT_PENDING" | "ACTIVE";

export const EXPIRING_SOON_DAYS = 7;

/**
 * Rule 4: status comes from dates and balance, checked in this order.
 * `latestEnd` is the latest end date across the member's non-cancelled memberships.
 */
export function membershipStatus(input: {
  suspended: boolean;
  latestEnd: IsoDate | null;
  outstanding: number;
  today: IsoDate;
}): MembershipStatus {
  if (input.suspended) return "SUSPENDED";
  const daysLeft = input.latestEnd ? daysBetween(input.latestEnd, input.today) : -1;
  if (daysLeft < 0) return "EXPIRED";
  if (daysLeft <= EXPIRING_SOON_DAYS) return "EXPIRING_SOON";
  if (input.outstanding > 0) return "PAYMENT_PENDING";
  return "ACTIVE";
}

/**
 * The plan to preselect when selling to a member without one: the first active plan of the gym's
 * default membership duration (Settings › Reminders). Plans come ordered status, months, price.
 */
export function defaultPlanFor<T extends { id: string; months: number }>(plans: T[], defaultMonths: number): T | undefined {
  return plans.find((p) => p.months === defaultMonths);
}
