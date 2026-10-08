import { createHmac, timingSafeEqual } from "node:crypto";
import { applyDeliveryStatus } from "@/lib/services/whatsapp";

// Meta WhatsApp Business → Fitron delivery receipts, for every gym at once: in the Meta app (once, not per gym), set the
// WhatsApp Business Account webhook callback URL to https://<your-domain>/api/webhooks/whatsapp, the verify token to
// WHATSAPP_VERIFY_TOKEN, and subscribe to "messages". Each gym's account is subscribed to the app when it connects. Payloads are
// signed with WHATSAPP_APP_SECRET; a receipt is matched to its message by the message id Meta returned when it was sent.

export function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (u.get("hub.mode") === "subscribe" && token && u.get("hub.verify_token") === token) return new Response(u.get("hub.challenge") ?? "");
  return new Response("Forbidden", { status: 403 });
}

function signed(raw: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret || !header?.startsWith("sha256=")) return false;
  const a = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const b = Buffer.from(header.slice(7));
  return a.length === b.length && timingSafeEqual(a, b);
}

type Status = { id: string; status: string; timestamp?: string; errors?: { title?: string; message?: string; error_data?: { details?: string } }[] };

export async function POST(req: Request) {
  const raw = await req.text();
  if (!signed(raw, req.headers.get("x-hub-signature-256"))) return Response.json({ error: "Bad signature" }, { status: 401 });
  const body = JSON.parse(raw) as { entry?: { changes?: { value?: { statuses?: Status[] } }[] }[] };
  for (const entry of body.entry ?? [])
    for (const change of entry.changes ?? [])
      for (const s of change.value?.statuses ?? []) {
        const err = s.errors?.[0];
        await applyDeliveryStatus(s.id, s.status, s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date(), err ? (err.error_data?.details ?? err.message ?? err.title) : undefined);
      }
  return Response.json({ ok: true });
}
