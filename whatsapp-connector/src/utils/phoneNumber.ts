import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { AppError } from "./errors.js";

// Phone numbers are stored and sent as E.164 digits without "+", e.g. 919876543210 — which is also the WhatsApp user id.
// Numbers without a country code are read in the default country (DEFAULT_COUNTRY, India out of the box); anything
// with + or 00 is parsed as written, so a UK or UAE member is never turned into an Indian number.

export type NormalizedPhone = { e164: string; digits: string; country: string | undefined; national: string };

const isCountry = (c: string): c is CountryCode => /^[A-Z]{2}$/.test(c);

export function normalizePhone(raw: string, defaultCountry = "IN"): NormalizedPhone {
  if (typeof raw !== "string") throw new AppError("INVALID_PHONE_NUMBER", "Phone number must be a string.");
  let s = raw.trim().replace(/[\s().-]/g, "");
  if (!s) throw new AppError("INVALID_PHONE_NUMBER", "Phone number is empty.");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  const country = isCountry(defaultCountry) ? defaultCountry : "IN";
  // A bare number: 10 digits is a national number in the default country; longer digit strings that start with the
  // default country's calling code (91…) are read as international without the +.
  let candidate = s;
  if (!s.startsWith("+")) {
    if (!/^\d+$/.test(s)) throw new AppError("INVALID_PHONE_NUMBER", "Phone number may only contain digits and a leading +.");
    if (s.length > 10) candidate = "+" + s;
  }
  const parsed = parsePhoneNumberFromString(candidate, country);
  if (!parsed || !parsed.isValid()) {
    // Retry a long bare number as a national number (e.g. a local 11-digit number with a trunk prefix).
    const retry = !s.startsWith("+") && s.length > 10 ? parsePhoneNumberFromString(s, country) : undefined;
    if (!retry || !retry.isValid()) throw new AppError("INVALID_PHONE_NUMBER", `"${raw}" is not a valid phone number.`);
    return { e164: retry.number, digits: retry.number.slice(1), country: retry.country, national: retry.formatNational() };
  }
  return { e164: parsed.number, digits: parsed.number.slice(1), country: parsed.country, national: parsed.formatNational() };
}

/** 919876543210 -> +91 98765 43210, for display. */
export function formatPhone(digits: string): string {
  const p = parsePhoneNumberFromString("+" + digits);
  return p ? p.formatInternational() : "+" + digits;
}

/** The WhatsApp user id for a normalised number. */
export const toJid = (digits: string): string => `${digits}@s.whatsapp.net`;

/** Digits from a WhatsApp user jid; null for groups, broadcast lists or LIDs. */
export function fromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const m = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return m ? (m[1] ?? null) : null;
}
