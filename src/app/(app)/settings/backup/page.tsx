import Link from "next/link";
import { ClockCounterClockwiseIcon, DatabaseIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { backupStatus, lastAutoFailure, lastRestoreTest, listBackups } from "@/lib/services/backup";
import { ageText, sizeText, summarise } from "@/lib/domain/backup";
import { Badge, Button, Card, Empty, Field, Input, LinkButton, Notice, TABLE, TD, TH, TR, ScrollRegion } from "@/components/ui";
import { Dialog, DialogButtons } from "@/components/dialog";
import { SettingsShell } from "@/components/section-tabs";
import { fmtDate, fmtStamp, fmtTime } from "@/lib/format";
import { backupNow, restoreFromFile, restoreFromServer } from "./actions";

export const metadata = { title: "Backup · Fitron" };

const KIND: Record<string, string> = { MANUAL: "Manual", AUTO: "Automatic", PRE_RESTORE: "Before restore" };
const stamp = (d: Date) => `${fmtStamp(d)}, ${fmtTime(d)}`;

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line-soft py-[7px] text-[15px]">
      <span>{k}</span>
      <span className="text-right text-muted">{v}</span>
    </div>
  );
}

/** One line about the weekly restore test: when it last ran and what it proved. */
function restoreTestText(t: Awaited<ReturnType<typeof lastRestoreTest>>) {
  if (!t) return "Every Sunday: the latest backup is restored in a trial run that is rolled back";
  if (t.ok === false) return `Failed on ${fmtDate(t.day)}`;
  if (t.ok === null) return `${fmtDate(t.day)}: ${t.note}`;
  return `Passed on ${fmtDate(t.day)} · ${t.rows.toLocaleString("en-IN")} records restored cleanly`;
}

export default async function BackupPage({ searchParams }: PageProps<"/settings/backup">) {
  // Open to a gym whose plan lapsed, so it can still take and download its data.
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  const sp = await searchParams;
  const superAdmin = u.role === "Super Admin";
  const [status, backups, failure, test] = await Promise.all([backupStatus(u.orgId), listBackups(u.orgId), lastAutoFailure(u.orgId), lastRestoreTest(u.orgId)]);
  const restore = typeof sp.restore === "string" && superAdmin ? sp.restore : null;
  const restoring = restore && restore !== "file" ? backups.find((b) => b.id === restore) : null;
  const now = new Date();

  return (
    <SettingsShell u={u} current="/settings/backup">
      <div className="flex max-w-[720px] flex-col gap-[18px]">
        {typeof sp.saved === "string" && (
          <Notice tone="ok">
            Backup saved. Download it and keep a copy off the server.{" "}
            <Link href={`/settings/backup/${encodeURIComponent(sp.saved)}/download`} prefetch={false} className="font-semibold underline">
              Download
            </Link>
          </Notice>
        )}
        {typeof sp.restored === "string" && <Notice tone="ok">Backup restored. Everything now matches the backup taken {sp.restored}. A safety copy of what was there before is in the list below.</Notice>}
        {typeof sp.error === "string" && !restore && <Notice tone="alert">{sp.error}</Notice>}
        {failure && (
          <Notice tone="alert">
            The automatic backup failed on {fmtDate(failure.day)}: {failure.error}. Back up now and check the server&apos;s storage (STORAGE_DIR or the S3 settings).
          </Notice>
        )}

        {test?.ok === false && (
          <Notice tone="alert">
            The weekly restore test failed on {fmtDate(test.day)}: {test.error} Your data is not affected, but back up now and download the file. If it fails again next week, write to support@fitron.in.
          </Notice>
        )}

        <div className="flex flex-col gap-[18px]">
          <Row k="Automatic backup" v="Daily with the morning jobs, kept 30 days" />
          <Row k="Last automatic backup" v={status.lastAutoAt ? stamp(status.lastAutoAt) : "Not yet — it runs with the daily jobs"} />
          <Row k="Last manual backup" v={status.lastManualAt ? `${stamp(status.lastManualAt)} by ${status.lastManualBy}` : "Never"} />
          <Row k="Restore test" v={restoreTestText(test)} />
          <Row k="Records" v={summarise(status.counts)} />
          <Row k="Backups on the server" v={`${status.files} files · ${sizeText(status.bytes)}`} />
        </div>

        <div className="flex flex-wrap gap-2.5">
          <form action={backupNow}>
            <Button variant="primary">
              <DatabaseIcon weight="duotone" size={16} />
              Back up now
            </Button>
          </form>
          {superAdmin && (
            <LinkButton href="/settings/backup?restore=file" scroll={false}>
              <ClockCounterClockwiseIcon weight="duotone" size={16} />
              Restore from file
            </LinkButton>
          )}
        </div>

        <p className="m-0 text-[13px] text-muted">
          Restoring replaces all current data and is limited to Super Admins. Every restore is written to the audit log. Member document files and staff photos are not inside the backup file; they stay in the server&apos;s storage, which the nightly server backup covers.
        </p>

        <Card title="Past backups">
          {backups.length === 0 ? (
            <Empty>No backups yet. Take one now, then download it and keep a copy off the server.</Empty>
          ) : (
            <ScrollRegion label="Backup table">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>When</th>
                    <th className={TH}>Age</th>
                    <th className={TH}>Kind</th>
                    <th className={TH}>Records</th>
                    <th className={TH}>Size</th>
                    <th className={TH}>By</th>
                    <th className={TH}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.id} className={TR}>
                      <td className={`${TD} whitespace-nowrap`}>{stamp(b.createdAt)}</td>
                      <td className={TD}>{ageText(b.createdAt, now)}</td>
                      <td className={TD}>
                        {KIND[b.kind] ?? b.kind}
                        {b.restoredAt && (
                          <div className="mt-1">
                            <Badge tone="accent">Restored {fmtStamp(b.restoredAt)}</Badge>
                          </div>
                        )}
                      </td>
                      <td className={TD}>{summarise(b.counts)}</td>
                      <td className={`${TD} whitespace-nowrap`}>{sizeText(b.size)}</td>
                      <td className={TD}>{b.createdBy}</td>
                      <td className={`${TD} text-right whitespace-nowrap`}>
                        <LinkButton variant="ghost" href={`/settings/backup/${b.id}/download`} prefetch={false}>
                          Download
                        </LinkButton>
                        {superAdmin && (
                          <LinkButton variant="ghost" href={`/settings/backup?restore=${b.id}`} scroll={false}>
                            Restore
                          </LinkButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </Card>
      </div>

      {restore && (restore === "file" || restoring) && (
        <Dialog
          kicker="Super Admin only"
          title={restoring ? `Restore the backup from ${stamp(restoring.createdAt)}` : "Restore from file"}
          note="All current data will be replaced by the backup. Download a fresh backup first if you are unsure."
          close="/settings/backup"
          error={typeof sp.error === "string" ? sp.error : undefined}
        >
          <form action={restoring ? restoreFromServer.bind(null, restoring.id) : restoreFromFile} className="flex flex-col gap-3.5">
            {!restoring && (
              <Field label="Backup file">
                <input type="file" name="file" accept=".json,application/json" required className="text-sm" />
              </Field>
            )}
            <Field label="Type RESTORE to confirm">
              <Input name="confirm" autoComplete="off" required placeholder="RESTORE" />
            </Field>
            <DialogButtons close="/settings/backup" label="Restore" />
          </form>
        </Dialog>
      )}
    </SettingsShell>
  );
}
