import { cronAuthorised } from "@/lib/services/cron-auth";
import { sendTrainerReminders } from "@/lib/services/trainer-push";

// AI Trainer push reminders. Call it every hour (deploy/scheduler.sh does) with
// "Authorization: Bearer $CRON_SECRET": each reminder goes once a day per device, in its own window.
export const maxDuration = 300;

async function handle(req: Request) {
  if (!cronAuthorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  return Response.json({ ok: true, ...(await sendTrainerReminders()) });
}

export const GET = handle;
export const POST = handle;
