import Link from "next/link";
import { ClockCounterClockwiseIcon, DatabaseIcon, LockSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import type { CurrentUser } from "@/lib/auth/current";
import { sizeText } from "@/lib/domain/backup";
import { readLocalSettings } from "@/lib/runtime/local-settings";
import { dataDirs } from "@/lib/runtime/paths";
import { fileInventory } from "@/lib/services/file-inventory";
import { localBackups } from "@/lib/services/local-backup";
import { EXPORTS } from "@/lib/services/exports";
import { Badge, Button, Card, Empty, Field, Input, LinkButton, Notice, TABLE, TD, TH, TR, ScrollRegion } from "@/components/ui";
import { Dialog, DialogButtons } from "@/components/dialog";
import { SettingsShell } from "@/components/section-tabs";
import { fmtStamp, fmtTime } from "@/lib/format";
import { localBackupNowAction, restoreLocalFromList, saveLocalBackupSettings } from "./actions";
import { RestoreUpload } from "./restore-upload";

const KIND = { manual: "Manual", auto: "Automatic", safety: "Before restore" } as const;
const stamp = (d: Date) => `${fmtStamp(d)}, ${fmtTime(d)}`;

/** Settings › Backup on FITRON for Windows: the whole computer's FITRON in one .fitronbackup file. */
export async function LocalBackupPage({ u, sp }: { u: CurrentUser; sp: Record<string, string | string[] | undefined> }) {
  const superAdmin = u.role === "Super Admin";
  const [backups, inv] = await Promise.all([localBackups(), fileInventory(u.orgId)]);
  const settings = readLocalSettings();
  const restore = typeof sp.restore === "string" && superAdmin ? sp.restore : null;
  const restoring = restore && restore !== "file" ? backups.find((b) => `${b.kind}/${b.name}` === restore) : null;
  const lastAuto = backups.find((b) => b.kind === "auto");
  const total = backups.reduce((n, b) => n + b.size, 0);

  return (
    <SettingsShell u={u} current="/settings/backup">
      <div className="flex max-w-[760px] flex-col gap-[18px]">
        {typeof sp.saved === "string" && (
          <Notice tone="ok">
            Backup saved as {sp.saved}. Download a copy to a pen drive or another computer: a backup on the same computer does not survive a lost or broken laptop.
          </Notice>
        )}
        {sp.settings && <Notice tone="ok">Backup settings saved.</Notice>}
        {typeof sp.error === "string" && !restore && <Notice tone="alert">{sp.error}</Notice>}
        {!superAdmin && <Notice tone="accent">Backups hold every record and login on this computer, so only a Super Admin can take, download or restore them.</Notice>}
        {inv.missing.length > 0 && (
          <Notice tone="alert">
            {inv.missing.length} {inv.missing.length === 1 ? "file is" : "files are"} missing from the documents folder (for example a member document deleted outside FITRON). The records are kept; restore a backup to bring the files back.
          </Notice>
        )}

        <Card title="This computer">
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-[15px]">
            <dt>Data folder</dt>
            <dd className="m-0 break-all text-muted">{dataDirs().root}</dd>
            <dt>Automatic backup</dt>
            <dd className="m-0 text-muted">{settings.autoBackup ? `Daily while FITRON is open, newest ${settings.keepAutoBackups} kept` : "Off"}</dd>
            <dt>Last automatic backup</dt>
            <dd className="m-0 text-muted">{lastAuto ? stamp(lastAuto.modifiedAt) : "Not yet"}</dd>
            <dt>Files</dt>
            <dd className="m-0 text-muted">
              {inv.present} of {inv.referenced.length} present · {sizeText(inv.bytes)}
            </dd>
            <dt>Backups here</dt>
            <dd className="m-0 text-muted">
              {backups.length} · {sizeText(total)}
            </dd>
          </dl>
        </Card>

        {superAdmin && (
          <Card title="Back up now">
            <form action={localBackupNowAction} className="flex flex-col gap-3">
              <p className="m-0 text-sm text-muted">
                The database, every member document and photo, and the two-step sign-in key, in one file. Add a password to keep the file unreadable to anyone who finds it; FITRON cannot recover a forgotten backup password.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Backup password (optional)">
                  <Input name="password" type="password" autoComplete="new-password" />
                </Field>
                <Field label="Password again">
                  <Input name="password2" type="password" autoComplete="new-password" />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Button variant="primary">
                  <DatabaseIcon weight="duotone" size={16} />
                  Back up now
                </Button>
                <LinkButton href="/settings/backup?restore=file" scroll={false}>
                  <ClockCounterClockwiseIcon weight="duotone" size={16} />
                  Restore from file
                </LinkButton>
              </div>
            </form>
          </Card>
        )}

        <Card title="Backup history">
          {backups.length === 0 ? (
            <Empty>No backups yet. Take one now, then download it and keep a copy off this computer.</Empty>
          ) : (
            <ScrollRegion label="Backup history">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>When</th>
                    <th className={TH}>Kind</th>
                    <th className={TH}>Contents</th>
                    <th className={TH}>Size</th>
                    <th className={TH}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={`${b.kind}/${b.name}`} className={TR}>
                      <td className={`${TD} whitespace-nowrap`}>
                        {stamp(b.modifiedAt)}
                        <div className="text-xs text-muted">{b.name}</div>
                      </td>
                      <td className={TD}>
                        {KIND[b.kind]}
                        {b.encrypted && (
                          <div className="mt-1">
                            <Badge tone="accent">
                              <LockSimpleIcon size={11} weight="bold" /> Password
                            </Badge>
                          </div>
                        )}
                      </td>
                      <td className={`${TD} text-sm`}>
                        {b.manifest
                          ? `${b.manifest.gyms.map((g) => g.name).join(", ")} · ${b.manifest.counts.Member ?? 0} members · ${b.manifest.counts.Invoice ?? 0} invoices · ${b.manifest.files.length - 1} files`
                          : "Locked with a password"}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>{sizeText(b.size)}</td>
                      <td className={`${TD} text-right whitespace-nowrap`}>
                        {superAdmin && (
                          <>
                            <a className="px-2 text-sm underline" href={`/settings/backup/local/${b.kind}/${encodeURIComponent(b.name)}`}>
                              Download
                            </a>
                            <LinkButton variant="ghost" href={`/settings/backup?${new URLSearchParams({ restore: `${b.kind}/${b.name}` })}`} scroll={false}>
                              Restore
                            </LinkButton>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </Card>

        {superAdmin && (
          <Card title="Automatic backup">
            <form action={saveLocalBackupSettings} className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="autoBackup" defaultChecked={settings.autoBackup} className="size-4" /> Back up automatically once a day
              </label>
              <Field label="Keep the newest">
                <Input name="keepAutoBackups" type="number" min={1} max={365} defaultValue={settings.keepAutoBackups} className="w-24" />
              </Field>
              <Button>Save</Button>
            </form>
          </Card>
        )}

        <Card title="Export data">
          <p className="m-0 mb-2 text-sm text-muted">Spreadsheets of your records, to open in Excel or give to your accountant. They are not a backup: restore needs a .fitronbackup file.</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(EXPORTS).map(([kind, e]) => (
              <Link key={kind} href={`/settings/export/${kind}`} prefetch={false} className="rounded-md border border-line px-3 py-1.5 text-sm">
                {e.label}
              </Link>
            ))}
          </div>
        </Card>
      </div>

      {restore === "file" && (
        <Dialog kicker="Super Admin only" title="Restore from file" note="Everything on this computer is replaced by the backup. FITRON first saves a safety backup of what is here now, and everyone is signed out." close="/settings/backup">
          <RestoreUpload />
        </Dialog>
      )}
      {restoring && (
        <Dialog
          kicker="Super Admin only"
          title={`Restore the backup from ${stamp(restoring.modifiedAt)}`}
          note="Everything on this computer is replaced by the backup. FITRON first saves a safety backup of what is here now, and everyone is signed out."
          close="/settings/backup"
          error={typeof sp.error === "string" ? sp.error : undefined}
        >
          <form action={restoreLocalFromList.bind(null, restoring.kind, restoring.name)} className="flex flex-col gap-3.5">
            {restoring.encrypted && (
              <Field label="Backup password">
                <Input name="password" type="password" autoComplete="off" required />
              </Field>
            )}
            <Field label="Type RESTORE to confirm">
              <Input name="confirm" autoComplete="off" required placeholder="RESTORE" />
            </Field>
            <DialogButtons close="/settings/backup" label="Restore" danger />
          </form>
        </Dialog>
      )}
    </SettingsShell>
  );
}
