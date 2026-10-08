import { fitronWebhookSecret, verifyWebhook } from "@/lib/integrations/razorpay";
import { applyFitronBillingEvent } from "@/lib/services/saas";
import { log } from "@/lib/log";

// Fitron's own Razorpay account → extra-branch payments. In that account's dashboard add
// https://<your-domain>/api/webhooks/fitron-billing with FITRON_RAZORPAY_WEBHOOK_SECRET and the
// payment.captured and payment.failed events.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("x-razorpay-signature"), fitronWebhookSecret())) return Response.json({ error: "Bad signature" }, { status: 400 });
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, result: await applyFitronBillingEvent(ev) });
  } catch (e) {
    log.error("fitron_billing_webhook.failed", e);
    return Response.json({ error: "Failed to apply" }, { status: 500 });
  }
}
