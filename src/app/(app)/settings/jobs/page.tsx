import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { JOBS, WEEKLY_JOBS, recentRuns, runDailyJobs } from "@/lib/services/jobs";
import { todayIso } from "@/lib/services/time";
import { Badge, Button, Card, Empty, Notice, PageHeader } from "@/components/ui";
import { SETTINGS_TABS, SectionTabs } from "@/components/section-tabs";
import { fmtDate, fmtTime } from "@/lib/format";

export const metadata = { title: "Daily jobs · Fitron" };

async function runNow() {
  "use server";
  const u = await requirePermission("settings.manage");
  await runDailyJobs(u.orgId);
  revalidatePath("/settings/jobs");
}

export default async function JobsPage() {
  const u = await requirePermission("settings.manage");
  const runs = await recentRuns(u.orgId);
  const labels = new Map([...JOBS, ...WEEKLY_JOBS].map((j) => [j.name, j.label]));
  const today = todayIso();
  const ranToday = runs.filter((r) => r.day === today);
  const days = [...new Set(runs.map((r) => r.day))];
  return (
    <>
      <PageHeader
        title="Daily jobs"
        subtitle={
          <>
            Reminders, birthday wishes, autopay and housekeeping, once a day.
            <br />
            <Link href="/settings?tab=help" className="text-accent">
              ← Back to Help &amp; support
            </Link>
          </>
        }
        actions={
          <form action={runNow}>
            <Button variant="primary">{ranToday.length ? "Run anything left for today" : "Run today's jobs now"}</Button>
          </form>
        }
      />
      <SectionTabs u={u} tabs={SETTINGS_TABS} current="/settings?tab=help" />
      <div className="mb-4">
        <Notice>
          On the server, a scheduler calls <code>/api/jobs/daily</code> each morning at about 6:30 with the <code>CRON_SECRET</code>. Each job runs once a day however many times it is called, and a failed job is retried on the next call. Messages held by quiet hours or a rule&apos;s Send at time go out when <code>/api/jobs/dispatch</code> is called (every 15 minutes), or when the WhatsApp page is opened. Once a week, on Sunday at about 2:30 at night, the scheduler calls <code>/api/jobs/weekly</code> to test that the latest backup restores.
        </Notice>
      </div>
      {days.length === 0 ? (
        <Empty>No jobs have run yet.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((d) => (
            <Card key={d} title={d === today ? `Today, ${fmtDate(d)}` : fmtDate(d)}>
              <ul className="divide-y divide-line text-sm">
                {runs
                  .filter((r) => r.day === d)
                  .map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        {labels.get(r.name) ?? r.name}
                        <span className="text-muted">
                          {" "}
                          · {fmtTime(r.startedAt)}
                          {r.result ? ` · ${Object.entries(r.result as Record<string, unknown>).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}
                        </span>
                      </span>
                      {r.error ? <Badge tone="alert">Failed: {r.error}</Badge> : r.finishedAt ? <Badge tone="ok">Done</Badge> : <Badge>Running</Badge>}
                    </li>
                  ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
