// Date-only helpers on ISO "YYYY-MM-DD" strings, computed in UTC so the
// server's time zone never shifts a membership by a day.

export type IsoDate = string;

const toUtc = (d: IsoDate): Date => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};

const toIso = (d: Date): IsoDate => d.toISOString().slice(0, 10);

export const addDays = (d: IsoDate, n: number): IsoDate => {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return toIso(x);
};

/** Adds calendar months, clamping to the last day (31 Jan + 1 month = 28/29 Feb). */
export const addMonths = (d: IsoDate, n: number): IsoDate => {
  const x = toUtc(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, lastDay));
  return toIso(x);
};

/** Whole days from `b` to `a` (a − b). */
export const daysBetween = (a: IsoDate, b: IsoDate): number =>
  Math.round((toUtc(a).getTime() - toUtc(b).getTime()) / 86_400_000);

/** A plan of `months` starting on `start` ends the day before the same date `months` later. */
export const membershipEndDate = (start: IsoDate, months: number): IsoDate =>
  addDays(addMonths(start, months), -1);
