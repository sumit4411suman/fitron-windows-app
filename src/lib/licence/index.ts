import "server-only";
import { gymAccountingOnly } from "@/lib/runtime/edition";
import { defaultDataRoot } from "@/lib/runtime/paths";
import { todayIso } from "@/lib/services/time";
import { UserError } from "@/lib/services/errors";
import { licenceWritable } from "./licence";
import { importLicence, readLicence } from "./store";
import { buyLink, collectPurchase, markOpened, waitingPurchase } from "./purchase";

export { TRIAL_DAYS, type LicenceStatus } from "./licence";

/** This installation's licence today (FITRON for Windows). */
export const thisLicence = (now = new Date()) => readLicence(defaultDataRoot(), todayIso(now));

/** Settings › Licence › Import. */
export const importThisLicence = (text: string, now = new Date()) => importLicence(defaultDataRoot(), text, todayIso(now));

/** Settings › Licence › Buy or renew: fitron.in's buy page for this computer (src/lib/licence/purchase.ts). */
export const thisBuyLink = (now = new Date()) => buyLink(defaultDataRoot(), todayIso(now), now);
export const markThisPurchaseOpened = () => markOpened(defaultDataRoot());
export const collectThisPurchase = (now = new Date()) => collectPurchase(defaultDataRoot(), todayIso(now), now);
/** Whether this computer is waiting for a licence bought on fitron.in (it then looks every hour). */
export const waitingForPurchase = (now = new Date()) => waitingPurchase(defaultDataRoot(), now) !== null;

export const LICENCE_ENDED_MESSAGE = "Your FITRON licence has ended, so nothing new can be added. Every record stays readable: collect dues, run reports, export and back up as usual. Buy or renew in Settings › Licence.";

/** New members, sales and invoices need a current licence on FITRON for Windows. The Cloud Edition goes by its plan. */
export function assertLicensed() {
  if (!gymAccountingOnly()) return;
  if (!licenceWritable(thisLicence().status)) throw new UserError(LICENCE_ENDED_MESSAGE);
}

/** Active branches this installation may have, or null on the Cloud Edition (its plan decides). */
export const licensedBranches = () => (gymAccountingOnly() ? thisLicence().status.branches : null);

/**
 * FITRON for Windows: the plan this computer's licence is for, which sets its member cap and features as on fitron.in
 * (src/lib/services/saas.ts gymPlan). Null during the trial (everything is open), and on the Cloud Edition.
 */
export function licensedPlanKey(): string | null {
  if (!gymAccountingOnly()) return null;
  const s = thisLicence().status;
  return s.kind === "active" || s.kind === "grace" || (s.kind === "ended" && s.licence) ? s.licence!.plan : null;
}
