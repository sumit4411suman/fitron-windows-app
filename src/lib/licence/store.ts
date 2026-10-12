import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readLocalSecrets } from "@/lib/runtime/local-secrets";
import { FITRON_LICENCE_KEYS } from "./keys";
import { licenceStatus, verifyLicence, type Licence, type LicenceStatus, type TrustedKey } from "./licence";
import { todayIso } from "@/lib/services/time";

// The licence of this installation, kept in its data folder beside the database:
//   licence.fitronlicence   the file FITRON sent, as imported
//   licence-state.json      the latest date the app has seen, so winding the computer's clock back does not bring back
//                           days of a licence or trial already used
// The installation's id and the day it was installed come from secrets.json (src/lib/runtime/local-secrets.ts).

export const licenceFile = (root: string) => path.join(root, "licence.fitronlicence");
const stateFile = (root: string) => path.join(root, "licence-state.json");

function readJson<T>(file: string): Partial<T> {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Partial<T>;
  } catch {
    return {};
  }
}

function writeAtomic(file: string, text: string) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

export type Installation = { installationId: string; installedOn: string };

/**
 * This computer's installation id and installation day; before secrets.json exists, a stand-in from today. The day is
 * the Indian calendar day of the installation, the same calendar as `today`: a computer set up after midnight in India
 * (still the day before in UTC) starts its trial on that day, not the day before.
 */
export function installation(root: string, today: string): Installation {
  const s = readLocalSecrets(root);
  const at = typeof s.createdAt === "string" ? new Date(s.createdAt) : null;
  return { installationId: s.installationId ?? "", installedOn: at && !Number.isNaN(at.getTime()) ? todayIso(at) : today };
}

/** The day to judge the licence by: today, or the latest day already seen if the computer's clock now says earlier. */
export function trustedToday(root: string, today: string): string {
  const seen = readJson<{ lastSeen: string }>(stateFile(root)).lastSeen;
  if (typeof seen === "string" && seen > today) return seen;
  if (seen !== today) {
    try {
      writeAtomic(stateFile(root), JSON.stringify({ lastSeen: today }));
    } catch {
      // A read-only data folder must not stop the app; the clock guard just does not move forward this time.
    }
  }
  return today;
}

export type LicenceView = { status: LicenceStatus; installationId: string; problem: string | null; hasKey: boolean };

/** Where this installation stands today. A damaged or foreign licence file is reported, and the trial rules apply. */
export function readLicence(root: string, today: string, keys: TrustedKey[] = FITRON_LICENCE_KEYS): LicenceView {
  const day = trustedToday(root, today);
  const inst = installation(root, day);
  let licence: Licence | null = null;
  let problem: string | null = null;
  if (existsSync(licenceFile(root))) {
    const v = verifyLicence(readFileSync(licenceFile(root), "utf8"), keys);
    if (v.ok) licence = v.licence;
    else problem = v.reason;
  }
  return { status: licenceStatus({ today: day, installedOn: inst.installedOn, installationId: inst.installationId, licence }), installationId: inst.installationId, problem, hasKey: keys.length > 0 };
}

/** Checks a licence FITRON sent and, when it is good for this computer, makes it this installation's licence. */
export function importLicence(root: string, text: string, today: string, keys: TrustedKey[] = FITRON_LICENCE_KEYS): { ok: true; licence: Licence } | { ok: false; reason: string } {
  const v = verifyLicence(text, keys);
  if (!v.ok) return v;
  const inst = installation(root, today);
  if (v.licence.installationId && v.licence.installationId !== inst.installationId) return { ok: false, reason: "This licence is for another computer. Send FITRON the installation id shown on this page." };
  writeAtomic(licenceFile(root), `${text.trim()}\n`);
  return { ok: true, licence: v.licence };
}
