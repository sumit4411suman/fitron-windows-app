import { cronAuthorised } from "@/lib/services/cron-auth";
import { runAllGymsWeekly } from "@/lib/services/jobs";

// Weekly jobs for every gym: the restore test of the latest backup. Call it once a week in the quiet hours (the scheduler
// does, on Sunday at 02:30 India time) with "Authorization: Bearer $CRON_SECRET". The test restores the backup inside a
// transaction that is always rolled back, and holds the gym's rows while it runs, so keep it away from opening hours.
// Calling it again the same day is harmless.
export const maxDuration = 300;

async function handle(req: Request) {
  if (!cronAuthorised(req)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const day = new URL(req.url).searchParams.get("day") ?? undefined;
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  return Response.json({ ok: true, results: await runAllGymsWeekly(day) });
}

export const GET = handle;
export const POST = handle;
