import { cronAuthorised } from "@/lib/services/cron-auth";
import { dispatchAllGyms } from "@/lib/services/jobs";
import { notInLocal } from "@/lib/runtime/not-in-local";

// Sends the WhatsApp messages held by quiet hours or a rule's send time, for every gym. Call it
// every 15 minutes with "Authorization: Bearer $CRON_SECRET"; nothing is sent twice.
export const maxDuration = 120;

async function handle(req: Request) {
  const off = notInLocal();
  if (off) return off;
  if (!cronAuthorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  return Response.json({ ok: true, results: await dispatchAllGyms() });
}

export const GET = handle;
export const POST = handle;
