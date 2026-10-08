import { db } from "@/lib/db";
import { memberWithRenewal, startTrainerCouponPayment, startTrainerPayment } from "@/lib/services/trainer";
import { body, json, withTrainer } from "../_lib/http";

/**
 * Start a payment to FITRON: returns what Razorpay Checkout needs. A plan with no coupon is a subscription that renews itself
 * (mode SUBSCRIPTION); with a coupon it is one payment at the reduced price (mode LIVE), or already paid when the coupon makes
 * it free (mode FREE, with the member). Without Razorpay set up it answers that payments are not switched on.
 */
export async function POST(req: Request) {
  return withTrainer(async (m) => {
    const b = await body<{ plan?: string; cycle?: string; kind?: string; coupon?: string }>(req);
    const what = { plan: String(b.plan ?? ""), cycle: String(b.cycle ?? ""), kind: String(b.kind ?? "") };
    const code = typeof b.coupon === "string" ? b.coupon.trim() : "";
    if (!code) return json(await startTrainerPayment(m.id, what));
    const r = await startTrainerCouponPayment(m.id, what, code);
    if (r.mode !== "FREE") return json(r);
    return json({ ...r, status: "PAID", member: await memberWithRenewal(await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })) });
  });
}
