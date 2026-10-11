import "server-only";
import { askService, serviceUrl, type ServiceAnswer } from "../service";

// The FITRON licence server, for FITRON for Windows. Phase 13 decides what a licence allows and how long it lasts with
// no internet; this file fixes what may leave the computer to ask about it, and nothing else does. A request carries the
// licence's own identifiers and the app's edition, plan and version: never a member, payment, invoice, expense, GST
// figure, attendance or accounting record. The payload is built from a closed list of fields, each a short code or a
// date, and anything else is refused before a connection is opened.
//
// FITRON_LICENCE_URL is the server (https). Unset, licence checks answer "not-configured" and FITRON keeps working.

export const LICENCE_FIELDS = ["licenceId", "installationId", "edition", "plan", "version", "activation", "expiresOn"] as const;
export type LicenceField = (typeof LICENCE_FIELDS)[number];
export type LicenceRequest = Partial<Record<LicenceField, string>> & { licenceId: string; installationId: string; edition: string; version: string };

/** A licence id, installation id (a UUID), edition, plan, version or activation state: letters, digits, `.`, `_`, `-`. */
const CODE = /^[A-Za-z0-9._-]{1,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The request body, from the allowed fields only. Throws on anything else, so customer data can never ride along. */
export function licencePayload(input: Record<string, unknown>): LicenceRequest {
  const extra = Object.keys(input).filter((k) => !(LICENCE_FIELDS as readonly string[]).includes(k));
  if (extra.length) throw new Error(`Not sent to the licence server: ${extra.join(", ")}. Only ${LICENCE_FIELDS.join(", ")} may be sent.`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (typeof v !== "string" || !(k === "expiresOn" ? DATE : CODE).test(v)) throw new Error(`Not sent to the licence server: ${k} is not a ${k === "expiresOn" ? "date" : "short code"}.`);
    out[k] = v;
  }
  for (const k of ["licenceId", "installationId", "edition", "version"] as const) if (!out[k]) throw new Error(`The licence request needs ${k}.`);
  return out as LicenceRequest;
}

export const licenceServer = (env: Record<string, string | undefined> = process.env) => serviceUrl(env.FITRON_LICENCE_URL);

/** Asks the licence server to check, activate or release a licence on this computer. Never throws for "offline". */
export async function askLicenceServer<T = unknown>(action: "check" | "activate" | "deactivate", input: Record<string, unknown>): Promise<ServiceAnswer<T>> {
  const body = licencePayload(input);
  const base = licenceServer();
  if (!base) return { ok: false, reason: "not-configured", message: "The licence server is not set up for this installation." };
  return askService<T>("Checking the FITRON licence", `${base}/v1/licences/${action}`, { method: "POST", body, then: "FITRON keeps working with the licence it already has. It checks again when the computer is online." });
}
