import { daysBetween } from "./dates";

/** Gym entry rules, from Setting "access". Money in paise. */
export type AccessRules = {
  blockSuspended: boolean;
  blockExpired: boolean;
  /** Days after expiry a member may still enter. */
  graceDays: number;
  blockDues: boolean;
  /** Dues above this block entry. */
  duesLimit: number;
  /** Opening hours as "HH:MM" (IST); empty means open all hours. */
  hoursFrom?: string;
  hoursTo?: string;
  /** No second entry without an exit. */
  antiPassback: boolean;
};

export const DEFAULT_ACCESS: AccessRules = { blockSuspended: true, blockExpired: true, graceDays: 0, blockDues: false, duesLimit: 0, hoursFrom: "", hoursTo: "", antiPassback: true };

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Why a member can't come in, or null if they can. `now` is the IST time "HH:MM", for the opening-hours rule. */
export function entryBlock(m: { suspended: boolean; latestEnd: string | null; outstanding: number }, rules: AccessRules, today: string, now?: string): string | null {
  if (rules.blockSuspended && m.suspended) return "Membership suspended";
  if (rules.blockExpired) {
    if (!m.latestEnd) return "No membership yet";
    const over = daysBetween(today, m.latestEnd);
    if (over > rules.graceDays) return `Membership ended ${over} day${over === 1 ? "" : "s"} ago`;
  }
  if (rules.blockDues && m.outstanding > rules.duesLimit) return `${inr(m.outstanding)} outstanding`;
  if (now && rules.hoursFrom && rules.hoursTo && (now < rules.hoursFrom || now > rules.hoursTo)) return "Outside gym hours";
  return null;
}

/** Anti-passback: why a second entry is refused while the member is still inside (insideSince = IST "HH:MM" of the open check-in). */
export function passbackBlock(rules: AccessRules, insideSince: string | null): string | null {
  return rules.antiPassback && insideSince ? `Already inside since ${insideSince} · no second entry without an exit` : null;
}
