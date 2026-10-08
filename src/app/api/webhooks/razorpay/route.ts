import { verifyWebhook } from "@/lib/integrations/razorpay";
import { applyRazorpayEvent } from "@/lib/services/autopay";
import { log } from "@/lib/log";

// Razorpay → Fitron. Add https://<your-domain>/api/webhooks/razorpay in the Razorpay dashboard
// with RAZORPAY_WEBHOOK_SECRET and the subscription.* and payment.failed events.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("x-razorpay-signature"))) return Response.json({ error: "Bad signature" }, { status: 400 });
  let ev;
  try {
    ev = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const eventId = req.headers.get("x-razorpay-event-id") ?? `${ev.event}:${ev.created_at}:${ev.payload?.payment?.entity?.id ?? ev.payload?.subscription?.entity?.id ?? ""}`;
  try {
    return Response.json({ ok: true, result: await applyRazorpayEvent(eventId, ev) });
  } catch (e) {
    log.error("razorpay_webhook.failed", e);
    // A 500 makes Razorpay retry later.
    return Response.json({ error: "Failed to apply" }, { status: 500 });
  }
}
