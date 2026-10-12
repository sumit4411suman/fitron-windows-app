// FITRON for Windows licences bought on fitron.in (docs/local-windows/LICENSING.md): the plans a Windows gym can buy, the
// shape of what the computer sends, and the licence a paid order becomes. Pure: the service is
// src/lib/services/windows-licence.ts, the computer's side src/lib/licence/purchase.ts.
import { findPlan } from "./pricing";
import { INCLUDED_BRANCHES, nextPeriod, planPrice, type Cycle } from "./saas";
import type { Licence } from "@/lib/licence/licence";

/** The Gym Accounting plans, at fitron.in's prices (pricing.ts): the same three a Windows gym can buy. */
export const WINDOWS_PLANS = ["starter", "professional", "enterprise"] as const;
export type WindowsPlan = (typeof WINDOWS_PLANS)[number];
export const isWindowsPlan = (p: string): p is WindowsPlan => (WINDOWS_PLANS as readonly string[]).includes(p);

/** Grace days after a bought licence ends, while the renewal arrives (the same as a licence FITRON issues by hand). */
export const WINDOWS_GRACE_DAYS = 15;

/** Active branches a plan's licence allows: Enterprise is multi-branch (as on fitron.in, with the branches it includes). */
export const windowsBranches = (plan: WindowsPlan) => (findPlan(plan)?.multiBranch ? INCLUDED_BRANCHES : 1);

/** A Windows installation id (Settings › Licence on the computer). */
export const INSTALLATION_ID = /^[A-Za-z0-9._-]{8,128}$/;
/** The one-time secret the computer makes when the owner presses Buy; only its SHA-256 is kept on fitron.in. */
export const CLAIM = /^[A-Za-z0-9_-]{32,128}$/;

/** What one period costs, GST included, split as on FITRON's invoices. */
export const windowsPrice = (plan: WindowsPlan, cycle: Cycle) => planPrice(plan, cycle);

/** The period a payment buys: after the computer's current paid period if it has not ended, else from today. */
export const windowsPeriod = (cycle: Cycle, today: string, lastEnd: string | null) => nextPeriod(cycle, today, lastEnd);

/** The licence a paid order becomes: for that one computer, until the end of the period paid for. */
export function windowsLicence(o: { licenceId: string; keyId: string; licensee: string; plan: WindowsPlan; installationId: string; today: string; periodEnd: string }): Licence {
  return {
    v: 1,
    licenceId: o.licenceId,
    keyId: o.keyId,
    licensee: o.licensee,
    plan: o.plan,
    edition: "local",
    branches: windowsBranches(o.plan),
    installationId: o.installationId,
    issuedOn: o.today,
    expiresOn: o.periodEnd,
    graceDays: WINDOWS_GRACE_DAYS,
  };
}

/** The buyer's details as typed on the page: a name for the licence, an email for the receipt, phone and GSTIN optional. */
export function buyerDetails(input: { licensee?: unknown; email?: unknown; phone?: unknown; gstin?: unknown }): { licensee: string; email: string; phone: string | null; gstin: string | null } | { error: string } {
  const licensee = typeof input.licensee === "string" ? input.licensee.trim().replace(/\s+/g, " ") : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const phone = typeof input.phone === "string" ? input.phone.replace(/[\s-]/g, "") : "";
  const gstin = typeof input.gstin === "string" ? input.gstin.trim().toUpperCase() : "";
  if (licensee.length < 2 || licensee.length > 120) return { error: "Enter the gym's or company's name (it is written on the licence)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: "Enter an email address for the receipt." };
  if (phone && !/^\+?\d{10,15}$/.test(phone)) return { error: "Enter the phone number with 10 digits, or leave it empty." };
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return { error: "That GSTIN does not look right (15 characters, like 27AAAPL1234C1Z5). Leave it empty if the gym has none." };
  return { licensee, email, phone: phone || null, gstin: gstin || null };
}
