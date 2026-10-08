import { memberWithRenewal } from "@/lib/services/trainer";
import { confirmTrainerOrder, confirmTrainerSubscription } from "@/lib/services/trainer-billing";
import { db } from "@/lib/db";
import { body, json, withTrainer } from "../../../_lib/http";

/**
 * Razorpay Checkout finished: the app sends what Checkout returned, a subscription's reply for a plan that renews itself or an
 * order's reply for a payment made with a coupon. Answers PAID once the plan is on, or PROCESSING when Razorpay hasn't
 * captured the payment yet (the plan then turns on by itself).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/trainer/pay/[id]/confirm">) {
  const { id } = await ctx.params;
  return withTrainer(async (m) => {
    const b = await body<{ razorpay_payment_id?: unknown; razorpay_subscription_id?: unknown; razorpay_order_id?: unknown; razorpay_signature?: unknown }>(req);
    const paymentId = String(b.razorpay_payment_id ?? "");
    const signature = String(b.razorpay_signature ?? "");
    const { status } = b.razorpay_order_id
      ? await confirmTrainerOrder(m.id, id, { orderId: String(b.razorpay_order_id), paymentId, signature })
      : await confirmTrainerSubscription(m.id, id, { paymentId, subscriptionId: String(b.razorpay_subscription_id ?? ""), signature });
    return json({ status, member: await memberWithRenewal(await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })) });
  });
}
