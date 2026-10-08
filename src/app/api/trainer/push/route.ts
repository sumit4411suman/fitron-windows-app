import { pushPublicKey, removePush, savePush, sendWelcomePush, type PushSubscriptionInput } from "@/lib/services/trainer-push";
import { body, json, withTrainer } from "../_lib/http";

/** The server's VAPID public key, or null when push reminders aren't set up. */
export async function GET() {
  return json({ publicKey: pushPublicKey() });
}

/** Keep this device's push subscription, and send the first push so the member sees it works. */
export async function POST(req: Request) {
  return withTrainer(async (m) => {
    const b = await body<{ subscription?: PushSubscriptionInput }>(req, 8_000);
    const p = await savePush(m.id, b.subscription ?? {}, req.headers.get("user-agent"));
    const delivered = await sendWelcomePush(m.id, p.endpoint);
    return json({ ok: true, delivered });
  });
}

/** Stop pushing to this device. */
export async function DELETE(req: Request) {
  return withTrainer(async (m) => {
    const b = await body<{ endpoint?: string }>(req, 8_000);
    await removePush(m.id, String(b.endpoint ?? ""));
    return json({ ok: true });
  });
}
