import { quoteTrainerCoupon } from "@/lib/services/trainer";
import { body, json, withTrainer } from "../_lib/http";

/** The coupon box before paying: what the typed code does to this plan's price (paise, GST included), or why it can't be used. Changes nothing. */
export async function POST(req: Request) {
  return withTrainer(async (m) => {
    const b = await body<{ plan?: string; cycle?: string; code?: string }>(req);
    return json(await quoteTrainerCoupon(m.id, { plan: String(b.plan ?? ""), cycle: String(b.cycle ?? ""), code: String(b.code ?? "") }));
  });
}
