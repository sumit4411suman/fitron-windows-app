import { createPublicKey, verify } from "node:crypto";

// A FITRON for Windows licence: a short text file FITRON signs and the gym imports in Settings › Licence. It is checked
// on the computer with FITRON's public key (keys.ts), so it works with no internet at all. Format, one line:
//
//   FITRON-LICENCE-1.<payload>.<signature>
//
// <payload> is the licence as JSON, base64url; <signature> is FITRON's Ed25519 signature over the payload's bytes, with
// the key named in it. Changing a single character of the payload breaks the signature.

export const LICENCE_PREFIX = "FITRON-LICENCE-1";

export type Licence = {
  v: 1;
  /** FITRON's id for this licence, e.g. "FIT-2026-00042". */
  licenceId: string;
  /** Which of FITRON's signing keys signed it (keys.ts), so keys can be replaced without breaking old licences. */
  keyId: string;
  /** Who it is for, as FITRON wrote it: the gym or company name. */
  licensee: string;
  plan: string;
  edition: "local";
  /** Active branches allowed. */
  branches: number;
  /** When set, the licence works only on the computer with this installation id (Settings › Licence shows it). */
  installationId?: string;
  issuedOn: string;
  expiresOn: string;
  /** Days FITRON keeps working, in full, after expiresOn, while the renewal arrives. */
  graceDays: number;
};

export type TrustedKey = { id: string; publicKey: string };

const b64url = (s: string) => Buffer.from(s, "base64url");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function shapeError(p: Partial<Licence>): string | null {
  if (p.v !== 1) return "an unknown licence version";
  if (typeof p.licenceId !== "string" || !p.licenceId) return "no licence id";
  if (typeof p.keyId !== "string" || !p.keyId) return "no key id";
  if (typeof p.licensee !== "string" || !p.licensee.trim()) return "no licensee";
  if (typeof p.plan !== "string" || !p.plan) return "no plan";
  if (p.edition !== "local") return "it is not for FITRON for Windows";
  if (!Number.isInteger(p.branches) || p.branches! < 1) return "no branch count";
  if (p.installationId !== undefined && typeof p.installationId !== "string") return "a bad installation id";
  if (!DATE.test(p.issuedOn ?? "") || !DATE.test(p.expiresOn ?? "")) return "bad dates";
  if (!Number.isInteger(p.graceDays) || p.graceDays! < 0 || p.graceDays! > 90) return "a bad grace period";
  return null;
}

export type Verified = { ok: true; licence: Licence } | { ok: false; reason: string };

/** Reads and checks a licence: the format, FITRON's signature, the fields. Never throws. */
export function verifyLicence(text: string, keys: TrustedKey[]): Verified {
  const parts = text.trim().split(".");
  if (parts.length !== 3 || parts[0] !== LICENCE_PREFIX) return { ok: false, reason: "This is not a FITRON licence file." };
  let licence: Partial<Licence>;
  try {
    licence = JSON.parse(b64url(parts[1]!).toString("utf8")) as Partial<Licence>;
  } catch {
    return { ok: false, reason: "This licence file is damaged." };
  }
  const key = keys.find((k) => k.id === licence.keyId);
  if (!key) return { ok: false, reason: keys.length ? "This licence was not signed by FITRON." : "This copy of FITRON has no licence key built in, so it cannot check licences. Ask FITRON support for an official build." };
  let good = false;
  try {
    good = verify(null, Buffer.from(parts[1]!, "utf8"), createPublicKey({ key: b64url(key.publicKey), format: "der", type: "spki" }), b64url(parts[2]!));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: "This licence was not signed by FITRON, or it was changed after signing." };
  const bad = shapeError(licence);
  if (bad) return { ok: false, reason: `This licence cannot be used: ${bad}.` };
  return { ok: true, licence: licence as Licence };
}

/** The 30 days FITRON for Windows works in full after it is installed, before a licence is needed. */
export const TRIAL_DAYS = 30;
/** Branches open during the trial and without a licence. */
export const TRIAL_BRANCHES = 3;

export type LicenceStatus =
  | { kind: "trial"; until: string; daysLeft: number; branches: number }
  | { kind: "active"; licence: Licence; daysLeft: number; branches: number }
  | { kind: "grace"; licence: Licence; graceUntil: string; daysLeft: number; branches: number }
  | { kind: "ended"; licence: Licence | null; since: string; branches: number }
  | { kind: "wrong-computer"; licence: Licence; trial: { until: string; daysLeft: number } | null; branches: number };

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Where this installation stands on a given day (the computer's own date, never earlier than one it has already seen:
 * see store.ts). A licence's last day and its grace days are included; the trial counts from the day of installation.
 */
export function licenceStatus(o: { today: string; installedOn: string; installationId: string; licence: Licence | null }): LicenceStatus {
  const trialUntil = addDays(o.installedOn, TRIAL_DAYS - 1);
  const trial = o.today <= trialUntil ? { until: trialUntil, daysLeft: daysBetween(o.today, trialUntil) + 1 } : null;
  const l = o.licence;
  if (!l) return trial ? { kind: "trial", ...trial, branches: TRIAL_BRANCHES } : { kind: "ended", licence: null, since: addDays(trialUntil, 1), branches: TRIAL_BRANCHES };
  if (l.installationId && l.installationId !== o.installationId) return { kind: "wrong-computer", licence: l, trial, branches: TRIAL_BRANCHES };
  if (o.today <= l.expiresOn) return { kind: "active", licence: l, daysLeft: daysBetween(o.today, l.expiresOn) + 1, branches: l.branches };
  const graceUntil = addDays(l.expiresOn, l.graceDays);
  if (o.today <= graceUntil) return { kind: "grace", licence: l, graceUntil, daysLeft: daysBetween(o.today, graceUntil) + 1, branches: l.branches };
  return { kind: "ended", licence: l, since: addDays(graceUntil, 1), branches: l.branches };
}

/** Whether new members, sales and invoices may be added. Viewing, collecting dues, reports, exports and backups always may. */
export const licenceWritable = (s: LicenceStatus) => s.kind === "trial" || s.kind === "active" || s.kind === "grace" || (s.kind === "wrong-computer" && s.trial !== null);
