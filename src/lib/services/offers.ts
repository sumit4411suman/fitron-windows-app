import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { normaliseCode, offerState } from "@/lib/domain/offers";
import { fmtDate } from "@/lib/format";
import type { OfferInput } from "@/lib/validation/plan";
import { audit } from "./audit";
import { isUniqueViolation, UserError } from "./errors";
import { fromIso, todayIso, toIso } from "./time";

export const listOffers = (u: CurrentUser) => db.offer.findMany({ where: { orgId: u.orgId }, orderBy: { createdAt: "desc" } });

export async function createOffer(u: CurrentUser, input: OfferInput) {
  try {
    return await db.$transaction(async (tx) => {
      const o = await tx.offer.create({
        data: { orgId: u.orgId, code: input.code, description: input.description, type: input.type, value: input.value, validTill: fromIso(input.validTill), usageLimit: input.usageLimit, createdById: u.id },
      });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "offer.create", entity: "Offer", entityId: o.id, after: o });
      return o;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError(`${input.code} already exists.`, "code");
    throw e;
  }
}

/** Pause or re-activate an offer. */
export async function setOfferStatus(u: CurrentUser, id: string, status: "ACTIVE" | "PAUSED") {
  const before = await db.offer.findFirst({ where: { orgId: u.orgId, id } });
  if (!before) throw new UserError("Offer not found.");
  await db.$transaction(async (tx) => {
    const after = await tx.offer.update({ where: { id }, data: { status } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: status === "PAUSED" ? "offer.pause" : "offer.activate", entity: "Offer", entityId: id, before, after });
  });
}

/** The offer for a code typed at the desk, or a clear error if it can't be used today. */
export async function usableOffer(orgId: string, raw: string) {
  const code = normaliseCode(raw);
  const o = await db.offer.findFirst({ where: { orgId, code } });
  if (!o) throw new UserError(`Offer code ${code} was not found.`, "offerCode");
  const validTill = toIso(o.validTill);
  const state = offerState({ ...o, validTill }, todayIso());
  if (state === "Expired") throw new UserError(`Offer code ${code} expired on ${fmtDate(validTill)}.`, "offerCode");
  if (state === "Paused") throw new UserError(`Offer code ${code} is paused.`, "offerCode");
  if (state === "Used up") throw new UserError(`Offer code ${code} has reached its usage limit.`, "offerCode");
  return o;
}

/** Counts one use inside the sale's transaction; fails if the last use was taken meanwhile. */
export async function takeOfferUse(tx: Prisma.TransactionClient, offerId: string) {
  const r = await tx.offer.updateMany({ where: { id: offerId, OR: [{ usageLimit: null }, { uses: { lt: db.offer.fields.usageLimit } }] }, data: { uses: { increment: 1 } } });
  if (!r.count) throw new UserError("That offer has just been used up.", "offerCode");
}
