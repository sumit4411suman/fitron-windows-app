// Gym dates are Indian calendar dates. Stored as @db.Date (midnight UTC).

const IST_OFFSET_MS = 330 * 60_000;

/** Today's date in India, as YYYY-MM-DD. */
export const todayIso = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
/** The Indian clock time now, "18:30". */
export const istClock = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);

export const toIso = (d: Date) => d.toISOString().slice(0, 10);

export const fromIso = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** The instant a given Indian clock time happens on a date: ("2026-09-28", "22:00") → Date. */
export const istInstant = (date: string, hhmm: string) => new Date(new Date(`${date}T${hhmm}:00.000Z`).getTime() - IST_OFFSET_MS);

/** The time now in India as "HH:MM". */
export const nowHHMM = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);

/** The current instant in milliseconds (a named helper, so pages can read the clock once per request). */
export const nowMs = () => Date.now();

/** The instant `n` days before now. */
export const daysAgo = (n: number, now = new Date()) => new Date(now.getTime() - n * 86_400_000);
