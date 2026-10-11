// Per-account lockout after repeated wrong passwords. The sign-in already limits attempts per address (5 a minute), but
// on the Local Edition every attempt comes from the same computer, and in the cloud a guesser can change address. So
// wrong passwords are also counted per email: after MAX_FAILURES within WINDOW_MS the account refuses passwords until the
// window has passed, whoever asks. A right password clears the count. Kept in memory: a restart clears it, which on a
// desktop needs someone at the computer anyway.

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;

const failures = new Map<string, number[]>();

const key = (email: string) => email.trim().toLowerCase();
const recent = (email: string, now: number) => (failures.get(key(email)) ?? []).filter((t) => now - t < WINDOW_MS);

/** Minutes left on a lockout, or 0 when the account may try a password. */
export function lockedMinutes(email: string, now = Date.now()): number {
  const r = recent(email, now);
  if (r.length < MAX_FAILURES) return 0;
  return Math.max(1, Math.ceil((r[r.length - MAX_FAILURES]! + WINDOW_MS - now) / 60_000));
}

export function recordFailure(email: string, now = Date.now()) {
  const r = recent(email, now);
  r.push(now);
  failures.set(key(email), r);
  if (failures.size > 5_000) for (const [k, v] of failures) if (!v.some((t) => now - t < WINDOW_MS)) failures.delete(k);
}

export function clearFailures(email: string) {
  failures.delete(key(email));
}
