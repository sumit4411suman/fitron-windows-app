import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// Time-based one-time codes (RFC 6238) for two-step sign-in: the 6-digit codes that Google Authenticator, Microsoft
// Authenticator, Authy, 1Password and others show, and the recovery codes for when the phone is lost. Pure functions
// over node:crypto, no dependency. The secret is stored sealed (src/lib/services/two-step.ts).

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const PERIOD_SECONDS = 30;
export const DIGITS = 6;
/** One step either side of now is accepted, for a phone clock that is a little off. */
const WINDOW = 1;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Not a base32 string");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 160 bits, as 32 base32 characters (what the authenticator app is given). */
export const generateSecret = () => base32Encode(randomBytes(20));

/** The code for one 30-second step (RFC 4226 dynamic truncation over HMAC-SHA1). */
export function codeAt(secret: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / PERIOD_SECONDS);

/**
 * The step a code is for, if it is right for now (or the step before or after), and is not one already used: `lastStep` is
 * the latest step accepted for this person, so a code seen once, by anyone, cannot be used again. Null when wrong.
 */
export function verifyCode(secret: string, input: string, now = Date.now(), lastStep: number | null = null): number | null {
  const code = input.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const want = Buffer.from(code);
  const current = stepAt(now);
  let hit: number | null = null;
  // Every step is checked, not just until the first match, so the time taken does not say which one was close.
  for (let s = current - WINDOW; s <= current + WINDOW; s++) {
    const got = Buffer.from(codeAt(secret, s));
    if (timingSafeEqual(got, want) && hit === null && (lastStep === null || s > lastStep)) hit = s;
  }
  return hit;
}

/** The address an authenticator app reads from the QR code. */
export function otpauthUrl({ secret, account, issuer }: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
}

/** "ABCD EFGH ..." in groups of four, for typing the secret by hand. */
export const groupSecret = (secret: string) => secret.replace(/(.{4})/g, "$1 ").trim();

// ── Recovery codes ────────────────────────────────────────────────────────

// No 0/O/1/I/L: they are read out and typed from paper.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_COUNT = 10;

/** Ten codes like "K7QX2-M9PTA" (50 bits each); each works once. */
export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const one = () => Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("");
  return Array.from({ length: n }, () => {
    const c = one();
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}

/** What was typed, as stored: upper case, without spaces or dashes. Null if it cannot be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-HJKMNP-Z2-9]{10}$/.test(c) ? c : null;
}
