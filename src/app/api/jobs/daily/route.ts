import { cronAuthorised } from "@/lib/services/cron-auth";
import { runAllGyms } from "@/lib/services/jobs";
import { sendTrainerReminders } from "@/lib/services/trainer-push";

// Daily jobs for every gym. Call it once a day around 06:30 IST (Vercel Cron, GitHub Actions,
// or any scheduler) with "Authorization: Bearer $CRON_SECRET". Calling it again the same day is harmless.
export const maxDuration = 300;

async function handle(req: Request) {
  if (!cronAuthorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const day = new URL(req.url).searchParams.get("day") ?? undefined;
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  const results = await runAllGyms(day);
  // The AI Trainer's morning reminders too, for servers that only call this once a day.
  const trainer = await sendTrainerReminders().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  return Response.json({ ok: true, results, trainer });
}

export const GET = handle;
export const POST = handle;
