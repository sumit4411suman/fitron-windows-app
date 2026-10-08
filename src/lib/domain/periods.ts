import { addDays, type IsoDate } from "./dates";

export const PERIODS = [
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["last", "Last month"],
  ["quarter", "This quarter"],
  ["year", "This year"],
  ["custom", "Custom"],
] as const;

export type PeriodKey = (typeof PERIODS)[number][0];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (y: number, m: number, d: number): IsoDate => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
/** "2026-10" or "2026-10-02" → "Oct 2026" */
export const monthLabel = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
/** "2026-10-02" → "2 Oct" */
const short = (d: IsoDate) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;

export const isPeriod = (p: unknown): p is PeriodKey => typeof p === "string" && PERIODS.some(([k]) => k === p);

/** Monday of the week containing `d`. */
export const weekStart = (d: IsoDate): IsoDate => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * The dashboard's date ranges, as in the prototype: everything runs up to today,
 * "Last month" is the whole previous month and "This year" is the Indian financial year (from 1 April).
 */
export function periodRange(p: PeriodKey, today: IsoDate, from?: string, to?: string): { from: IsoDate; to: IsoDate; label: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  switch (p) {
    case "today":
      return { from: today, to: today, label: "today" };
    case "week":
      return { from: weekStart(today), to: today, label: "this week" };
    case "last": {
      const start = iso(y, m - 1, 1);
      return { from: start, to: iso(y, m, 0), label: monthLabel(start) };
    }
    case "quarter":
      return { from: iso(y, Math.floor(m / 3) * 3, 1), to: today, label: "this quarter" };
    case "year": {
      const fy = m >= 3 ? y : y - 1;
      return { from: iso(fy, 3, 1), to: today, label: `FY ${fy}–${String(fy + 1).slice(2)}` };
    }
    case "custom": {
      const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : today);
      let a = valid(from);
      let b = valid(to);
      if (a > b) [a, b] = [b, a];
      return { from: a, to: b, label: `${short(a)} – ${short(b)}` };
    }
    default:
      return { from: iso(y, m, 1), to: today, label: monthLabel(today) };
  }
}

/** The 12 months ending with the one containing `today`, oldest first, as "YYYY-MM". */
export function monthsBack(today: IsoDate, n = 12): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: n }, (_, i) => iso(y, m - (n - 1 - i), 1).slice(0, 7));
}

/** Last day of a "YYYY-MM" month. */
export const monthEnd = (ym: string): IsoDate => iso(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0);
