import "server-only";
import { gymAccountingOnly } from "@/lib/runtime/edition";
import { defaultDataRoot } from "@/lib/runtime/paths";
import { todayIso } from "@/lib/services/time";
import { UserError } from "@/lib/services/errors";
import { licenceWritable } from "./licence";
import { importLicence, readLicence } from "./store";

export { TRIAL_DAYS, type LicenceStatus } from "./licence";

/** This installation's licence today (FITRON for Windows). */
export const thisLicence = (now = new Date()) => readLicence(defaultDataRoot(), todayIso(now));

/** Settings › Licence › Import. */
export const importThisLicence = (text: string, now = new Date()) => importLicence(defaultDataRoot(), text, todayIso(now));

export const LICENCE_ENDED_MESSAGE = "Your FITRON licence has ended, so nothing new can be added. Every record stays readable: collect dues, run reports, export and back up as usual. Import a new licence in Settings › Licence.";

/** New members, sales and invoices need a current licence on FITRON for Windows. The Cloud Edition goes by its plan. */
export function assertLicensed() {
  if (!gymAccountingOnly()) return;
  if (!licenceWritable(thisLicence().status)) throw new UserError(LICENCE_ENDED_MESSAGE);
}

/** Active branches this installation may have, or null on the Cloud Edition (its plan decides). */
export const licensedBranches = () => (gymAccountingOnly() ? thisLicence().status.branches : null);
