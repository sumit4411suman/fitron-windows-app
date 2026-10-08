import "server-only";
import { db } from "@/lib/db";
import type { Coupon, Prisma } from "@/generated/prisma/client";
import { applyCoupon, COUPON_AUDIENCE_PHRASE, couponCovers, couponState, HOLD_MINUTES, normaliseCode, type CouponAudience, type CouponProduct } from "@/lib/domain/coupons";
import { rateLimit } from "@/lib/rate-limit";
import type { CouponInput } from "@/lib/validation/coupon";
import { isUniqueViolation, UserError } from "./errors";
import { fromIso, todayIso, toIso } from "./time";

// Coupons for payments to FITRON. The FITRON team makes them (fitron-admin/coupons); a gym (Settings › Plan & billing) or
// an AI Trainer member types one before paying. A payment started with a coupon holds one of its uses for a while
// (PENDING), becomes a use when the payment is made (USED), and gives it back when it fails or is started again (RELEASED).

type Tx = Prisma.TransactionClient | typeof db;

/** Who is paying: a gym or an AI Trainer member. Each may use a coupon once. */
export type Payer = { orgId: string; memberId?: undefined } | { memberId: string; orgId?: undefined };

const own = (p: Payer) => (p.orgId ? { orgId: p.orgId } : { memberId: p.memberId });

export type CouponQuote = {
  coupon: Coupon;
  code: string;
  percentOff: number;
  /** Paise: set when the coupon charges a flat amount instead of a percentage off. */
  payPaise: number | null;
  /** The listed price, what the coupon takes off, and what is left to pay (paise, GST included). */
  listTotal: number;
  discount: number;
  total: number;
};

/** Uses spoken for: payments made, and payments started in the last HOLD_MINUTES (not counting the payer's own: they may start again). */
async function taken(tx: Tx, couponId: string, payer?: Payer) {
  const since = new Date(Date.now() - HOLD_MINUTES * 60_000);
  return tx.couponRedemption.count({
    where: { couponId, OR: [{ status: "USED" }, { status: "PENDING", createdAt: { gte: since }, ...(payer ? { NOT: own(payer) } : {}) }] },
  });
}

/** Throws a message the payer can read unless this coupon can be used by them on this product today. */
async function assertUsable(tx: Tx, coupon: Coupon, product: CouponProduct, payer: Payer) {
  const state = couponState({ ...coupon, validTill: coupon.validTill ? toIso(coupon.validTill) : null }, await taken(tx, coupon.id, payer), todayIso());
  if (state === "Expired") throw new UserError(`Coupon ${coupon.code} has expired.`, "coupon");
  if (state === "Paused") throw new UserError("That coupon code isn't valid.", "coupon");
  if (state === "Used up") throw new UserError(`Coupon ${coupon.code} has been fully used.`, "coupon");
  if (!couponCovers(coupon.appliesTo, product)) throw new UserError(`Coupon ${coupon.code} only works on ${COUPON_AUDIENCE_PHRASE[coupon.appliesTo as CouponAudience] ?? "other payments"}, not on this one.`, "coupon");
  if (await tx.couponRedemption.count({ where: { couponId: coupon.id, status: "USED", ...own(payer) } })) throw new UserError(`You have already used coupon ${coupon.code}.`, "coupon");
}

/**
 * What a typed coupon does to a price, or a clear error. Changes nothing: starting the payment holds the use (reserveCoupon).
 * `listTotal` is the price the payer would otherwise be charged, paise with GST inside.
 */
export async function quoteCoupon(raw: string, product: CouponProduct, payer: Payer, listTotal: number): Promise<CouponQuote> {
  const code = normaliseCode(raw);
  if (!code) throw new UserError("Enter a coupon code.", "coupon");
  // Codes are short words, so guessing them is limited.
  if (!rateLimit(`coupon:${payer.orgId ?? payer.memberId}`, 20, 10 * 60_000)) throw new UserError("Too many coupon tries in a few minutes. Wait a little and try again.", "coupon");
  const coupon = await db.coupon.findUnique({ where: { code } });
  if (!coupon) throw new UserError("That coupon code isn't valid.", "coupon");
  await assertUsable(db, coupon, product, payer);
  return { coupon, code, percentOff: coupon.percentOff, payPaise: coupon.payPaise, listTotal, ...applyCoupon(listTotal, coupon.percentOff, coupon.payPaise) };
}

/**
 * Holds a use of the coupon for the payment being made, inside the transaction that makes it. One at a time per coupon, and
 * the checks are made again here, so a coupon with one use left cannot be taken by two payers. Any earlier payment of the
 * payer's own with this coupon that was never finished gives its place back.
 */
export async function reserveCoupon(tx: Prisma.TransactionClient, quote: CouponQuote, product: CouponProduct, payer: Payer, paymentId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`coupon:${quote.coupon.id}`}))`;
  const coupon = await tx.coupon.findUniqueOrThrow({ where: { id: quote.coupon.id } });
  await tx.couponRedemption.updateMany({ where: { couponId: coupon.id, status: "PENDING", ...own(payer) }, data: { status: "RELEASED" } });
  await assertUsable(tx, coupon, product, payer);
  await tx.couponRedemption.create({
    data: { couponId: coupon.id, ...own(payer), paymentId, listTotal: quote.listTotal, discount: quote.discount, paid: quote.total },
  });
}

/** The payment was made: the held use becomes a use. Safe to call again. */
export const markCouponUsed = (tx: Tx, paymentId: string) =>
  tx.couponRedemption.updateMany({ where: { paymentId, status: { not: "USED" } }, data: { status: "USED", usedAt: new Date() } });

/** The payment failed: the use goes back to the coupon. A payment already made keeps it. */
export const releaseCoupon = (tx: Tx, paymentId: string) => tx.couponRedemption.updateMany({ where: { paymentId, status: "PENDING" }, data: { status: "RELEASED" } });

// ── The FITRON team's page ──────────────────────────────────────────────────────────────────────

/** Every coupon, newest first, with how many times it was used and where it stands today. */
export async function listCoupons(today = todayIso()) {
  const since = new Date(Date.now() - HOLD_MINUTES * 60_000);
  const [coupons, used, held] = await Promise.all([
    db.coupon.findMany({ orderBy: { createdAt: "desc" } }),
    db.couponRedemption.groupBy({ by: ["couponId"], where: { status: "USED" }, _count: true, _sum: { discount: true } }),
    db.couponRedemption.groupBy({ by: ["couponId"], where: { status: "PENDING", createdAt: { gte: since } }, _count: true }),
  ]);
  const usedBy = new Map(used.map((r) => [r.couponId, r]));
  const heldBy = new Map(held.map((r) => [r.couponId, r._count]));
  return coupons.map((c) => {
    const uses = usedBy.get(c.id)?._count ?? 0;
    return {
      ...c,
      validTill: c.validTill ? toIso(c.validTill) : null,
      uses,
      given: usedBy.get(c.id)?._sum.discount ?? 0,
      state: couponState({ ...c, validTill: c.validTill ? toIso(c.validTill) : null }, uses + (heldBy.get(c.id) ?? 0), today),
    };
  });
}

/** The latest payments that used a coupon, with who paid, for the admin page. */
export async function recentRedemptions(take = 15) {
  const rows = await db.couponRedemption.findMany({ where: { status: "USED" }, orderBy: { usedAt: "desc" }, take, include: { coupon: { select: { code: true } } } });
  const [orgs, members] = await Promise.all([
    db.organization.findMany({ where: { id: { in: rows.flatMap((r) => (r.orgId ? [r.orgId] : [])) } }, select: { id: true, name: true } }),
    db.trainerMember.findMany({ where: { id: { in: rows.flatMap((r) => (r.memberId ? [r.memberId] : [])) } }, select: { id: true, email: true, name: true } }),
  ]);
  return rows.map((r) => {
    const org = orgs.find((o) => o.id === r.orgId);
    const m = members.find((x) => x.id === r.memberId);
    return { id: r.id, code: r.coupon.code, usedAt: r.usedAt!, who: org ? `${org.name} (gym)` : m ? `${m.name || m.email} (AI Trainer)` : "—", listTotal: r.listTotal, discount: r.discount, paid: r.paid };
  });
}

export async function createCoupon(by: string, input: CouponInput) {
  try {
    return await db.coupon.create({
      data: { code: input.code, description: input.description, percentOff: input.percentOff, payPaise: input.payRupees ? input.payRupees * 100 : null, appliesTo: input.appliesTo, validTill: input.validTill ? fromIso(input.validTill) : null, usageLimit: input.usageLimit, createdBy: by },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError(`${input.code} already exists.`, "code");
    throw e;
  }
}

/** Pause a coupon so it stops working, or switch it back on. */
export async function setCouponStatus(id: string, status: "ACTIVE" | "PAUSED") {
  const r = await db.coupon.updateMany({ where: { id }, data: { status } });
  if (!r.count) throw new UserError("Coupon not found.");
}

/** Remove a coupon nobody has used. One that was used is kept for the records: pause it instead. */
export async function deleteCoupon(id: string) {
  if (await db.couponRedemption.count({ where: { couponId: id } })) throw new UserError("This coupon has been used, so it is kept for the records. Pause it instead.");
  await db.coupon.deleteMany({ where: { id } });
}
