import { addDays, daysBetween, type IsoDate } from "./dates";

export type FreezeLike = { fromDate: IsoDate; days: number; endedOn: IsoDate | null };

export const FREEZE_REASONS = ["Travel", "Medical", "Exams", "Personal", "Other"] as const;

/** Last frozen day. */
export const freezeLastDay = (f: FreezeLike) => addDays(f.fromDate, f.days - 1);

/** Still on hold: not unfrozen, and its days haven't all passed. A freeze starting later counts too (prototype). */
export const freezeOpen = (f: FreezeLike, today: IsoDate) => !f.endedOn && freezeLastDay(f) >= today;

/** Check-in is refused on the frozen days themselves. */
export const freezeCovers = (f: FreezeLike, today: IsoDate) => !f.endedOn && f.fromDate <= today && freezeLastDay(f) >= today;

/** Days given back when unfrozen today: the frozen days not yet used. */
export const unusedFreezeDays = (f: FreezeLike, today: IsoDate) => Math.max(0, f.days - Math.max(0, daysBetween(today, f.fromDate)));
