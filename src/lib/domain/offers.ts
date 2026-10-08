import type { IsoDate } from "./dates";

export type OfferLike = { type: string; value: number; validTill: IsoDate; usageLimit: number | null; uses: number; status: string };

/** "Active", "Paused" or "Expired" (past its last day), as the prototype labels offers. */
export const offerState = (o: OfferLike, today: IsoDate) => (o.validTill < today ? "Expired" : o.status === "PAUSED" ? "Paused" : o.usageLimit !== null && o.uses >= o.usageLimit ? "Used up" : "Active");

export const offerUsable = (o: OfferLike, today: IsoDate) => offerState(o, today) === "Active";

/** The discount an offer gives on a price (paise), never more than the price. */
export const offerDiscount = (o: Pick<OfferLike, "type" | "value">, price: number) => Math.min(price, o.type === "PERCENT" ? Math.round((price * o.value) / 100) : o.value);

/** Codes are stored upper-case without spaces. */
export const normaliseCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");
