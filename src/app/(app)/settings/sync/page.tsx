import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { Badge, Button, Card, Field, Input, Notice, Stat, TABLE, TD, TH, TR, ScrollRegion } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { SettingsShell } from "@/components/section-tabs";
import { fmtClock, fmtStamp } from "@/lib/format";
import { istClock } from "@/lib/services/time";
import { isLocal } from "@/lib/runtime/edition";
import { takeRecoveryKey } from "@/lib/services/local-setup";
import { DEVICE_RANGE } from "@/lib/services/sequence";
import { failedChanges, readState, syncCounts } from "@/lib/sync/client";
import { listDevices } from "@/lib/sync/server";
import { workerStatus } from "@/lib/sync/worker";
import { dismissFailedAction, linkFromCloudAction, linkToCloudAction, resolveConflictAction, retryFailedAction, revokeDeviceAction, syncNowAction, unlinkComputerAction } from "./actions";

export const metadata = { title: "Cloud sync · Fitron" };

const when = (d: Date | null | undefined) => (d ? `${fmtStamp(d)}, ${fmtClock(istClock(d))}` : "never");
const label = (entity: string) => entity.replace(/([a-z])([A-Z])/g, "$1 $2");
const box = "flex flex-col gap-3.5";

export default async function SyncPage({ searchParams }: PageProps<"/settings/sync">) {
  const u = await requirePermission("settings.manage");
  const sp = await searchParams;
  const msg = (
    <>
      {typeof sp.ok === "string" && <Notice tone="ok">{sp.ok}</Notice>}
      {typeof sp.error === "string" && <Notice tone="alert">{sp.error}</Notice>}
    </>
  );
  return (
    <SettingsShell u={u} current="/settings/sync">
      <div className="flex max-w-[860px] flex-col gap-[18px]">
        {msg}
        {isLocal() ? <OnComputer userId={u.id} linkedNow={sp.linked === "1"} email={u.email} /> : <OnWebsite orgId={u.orgId} />}
      </div>
    </SettingsShell>
  );
}

async function OnComputer({ userId, linkedNow, email }: { userId: string; linkedNow: boolean; email: string }) {
  const state = await readState();
  if (!state?.linked) return <NotLinked email={email} />;
  const [counts, failed, conflicts, gym, worker] = await Promise.all([
    syncCounts(),
    failedChanges(),
    db.syncConflict.findMany({ where: { resolvedAt: null }, orderBy: { openedAt: "desc" }, take: 50 }),
    db.organization.findUnique({ where: { id: state.orgId }, select: { name: true } }),
    Promise.resolve(workerStatus()),
  ]);
  const key = linkedNow ? takeRecoveryKey(userId) : null;
  const status = worker.revoked
    ? { tone: "alert" as const, text: "Unlinked on fitron.in: changes are kept here and not sent. Unlink this computer below, then link it again." }
    : state.lastError
      ? { tone: "alert" as const, text: `${counts.pending ? "Offline or failing" : "Not reaching fitron.in"}: ${state.lastError}` }
      : counts.pending
        ? { tone: "neutral" as const, text: `Syncing: ${counts.pending} ${counts.pending === 1 ? "change waits" : "changes wait"} to go up.` }
        : { tone: "ok" as const, text: `Connected. Everything is in step with fitron.in (last sync ${when(state.lastOkAt)}).` };
  return (
    <>
      {key && (
        <Notice tone="ok">
          Linked. Your new recovery key for this computer: <code className="font-semibold">{key}</code>. Write it down and keep it safe: it is shown once, and it lets you back in if you forget your password while offline.
        </Notice>
      )}
      <Notice tone={status.tone}>{status.text}</Notice>
      <Card title="Linked to fitron.in">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Waiting to go up" value={counts.pending} />
          <Stat label="Refused" value={counts.failed} tone={counts.failed ? "alert" : undefined} />
          <Stat label="Conflicts" value={counts.conflicts} tone={counts.conflicts ? "alert" : undefined} />
          <Stat label="Last sync" value={<span className="text-base">{when(state.lastOkAt)}</span>} />
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted">Gym</dt>
          <dd className="m-0">{gym?.name ?? "—"}</dd>
          <dt className="text-muted">fitron.in account</dt>
          <dd className="m-0">{state.linkedEmail}</dd>
          <dt className="text-muted">This computer</dt>
          <dd className="m-0">
            Number {state.deviceNo}: its invoices, payments and members are numbered from {(state.deviceNo * DEVICE_RANGE + 1).toLocaleString("en-IN")} so they never clash with the website&apos;s.
          </dd>
          <dt className="text-muted">Linked</dt>
          <dd className="m-0">{when(state.linkedAt)}</dd>
        </dl>
        <p className="mt-3 mb-0 text-[13px] text-muted">
          Changes made here are saved at once and go up within seconds when the internet is on; changes on fitron.in come down the same way. Offline, nothing waits: the desk works as usual and everything goes up when the connection is back. While linked, the daily
          jobs (reminders, autopay, risk scores) run on fitron.in, so members get each message once.
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          <form action={syncNowAction}>
            <Button variant="primary">Sync now</Button>
          </form>
          <form action={unlinkComputerAction}>
            <ConfirmButton confirm="Unlink this computer from fitron.in? Its records stay here, but changes are no longer sent either way.">Unlink this computer</ConfirmButton>
          </form>
        </div>
      </Card>

      {failed.length > 0 && (
        <Card title="Refused by fitron.in" action={<RetryAll />}>
          <p className="m-0 mb-2.5 text-[13px] text-muted">These changes are saved on this computer but fitron.in did not take them, for the reason shown. Fix the cause (on the website or here), then send them again; or keep them on this computer only.</p>
          <ScrollRegion label="Refused changes">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Record</th>
                  <th className={TH}>Why</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {failed.map((f) => (
                  <tr key={String(f.seq)} className={TR}>
                    <td className={TD}>
                      {label(f.entity)} <span className="text-muted">{f.entityId.slice(-8)}</span>
                    </td>
                    <td className={TD}>{f.error}</td>
                    <td className={TD}>
                      <div className="flex gap-1.5">
                        <form action={retryFailedAction}>
                          <input type="hidden" name="seq" value={String(f.seq)} />
                          <Button>Send again</Button>
                        </form>
                        <form action={dismissFailedAction}>
                          <input type="hidden" name="seq" value={String(f.seq)} />
                          <Button>Keep here only</Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </Card>
      )}

      {conflicts.length > 0 && (
        <Card title="Conflicts">
          <p className="m-0 mb-2.5 text-[13px] text-muted">The same record was changed here and on fitron.in before they synced. Nothing was lost: both versions are kept until you choose. Money records keep the website&apos;s version; re-enter a payment or reversal here if it is still needed.</p>
          <div className="flex flex-col gap-3">
            {conflicts.map((c) => (
              <div key={c.id} className="rounded-md border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{label(c.entity)}</strong>
                  <span className="text-muted">{c.entityId.slice(-8)}</span>
                  <Badge tone={c.kind === "merged" ? "neutral" : "alert"}>{{ merged: "both changed", "kept-website": "website's kept", deleted: "deleted on one side", "not-applied": "could not be applied here", "only-here": "only on this computer" }[c.kind] ?? c.kind}</Badge>
                  {c.fields && c.kind !== "not-applied" && <span className="text-muted">Fields: {c.fields}</span>}
                </div>
                {c.kind === "not-applied" && <p className="m-0 mt-1 text-muted">{c.fields}</p>}
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Version title="This computer's" row={c.ours} fields={c.fields} />
                  <Version title="fitron.in's" row={c.theirs} fields={c.fields} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.ours != null && <ResolveButton id={c.id} keep="ours" text="Keep this computer's" />}
                  {c.theirs != null && <ResolveButton id={c.id} keep="theirs" text="Keep fitron.in's" />}
                  <ResolveButton id={c.id} keep="dismiss" text="Dismiss" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function RetryAll() {
  return (
    <form action={retryFailedAction}>
      <Button>Send all again</Button>
    </form>
  );
}

function ResolveButton({ id, keep, text }: { id: string; keep: string; text: string }) {
  return (
    <form action={resolveConflictAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="keep" value={keep} />
      <Button>{text}</Button>
    </form>
  );
}

function Version({ title, row, fields }: { title: string; row: unknown; fields: string }) {
  const show = fields ? fields.split(",") : [];
  const r = (row ?? null) as Record<string, unknown> | null;
  return (
    <div className="rounded bg-bg p-2">
      <div className="text-xs text-muted">{title}</div>
      {!r ? (
        <div className="text-muted">Deleted</div>
      ) : (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 text-[13px]">
          {(show.length ? show : ["name", "number", "amount", "status"].filter((k) => k in r)).map((k) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="m-0 break-all">{r[k] === null || r[k] === undefined ? "—" : typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function NotLinked({ email }: { email: string }) {
  return (
    <>
      <Notice>
        Not linked. Everything stays on this computer. Link it to the gym&apos;s fitron.in account to keep both in step: changes on either side reach the other within seconds whenever the internet is on, and the desk keeps working offline.
      </Notice>
      <Card title="Use the gym that is on fitron.in">
        <form action={linkFromCloudAction} className={box}>
          <p className="m-0 text-[13px] text-muted">
            For a gym already using fitron.in. Its members, plans, invoices, payments and the rest come down to this computer and replace what is here. A safety backup is taken first. Sign in with the fitron.in account of the gym&apos;s Super Admin.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="fitron.in email">
              <Input name="email" type="email" required autoComplete="username" />
            </Field>
            <Field label="fitron.in password">
              <Input name="password" type="password" required autoComplete="current-password" />
            </Field>
            <Field label="Two-step code" hint="Only if your fitron.in account asks for one.">
              <Input name="code" inputMode="numeric" autoComplete="one-time-code" />
            </Field>
            <Field label="Type REPLACE" hint="Needed only when this computer already has members, invoices or payments.">
              <Input name="confirm" autoComplete="off" />
            </Field>
          </div>
          <div>
            <Button variant="primary">Link and download the gym</Button>
          </div>
        </form>
      </Card>
      <Card title="Put this gym on fitron.in">
        <form action={linkToCloudAction} className={box}>
          <p className="m-0 text-[13px] text-muted">
            For a gym set up on this computer. FITRON makes a fitron.in account for it, owned by you, and uploads its records; the website then works on the same books. Choose a password for fitron.in; confirm the email from the message fitron.in sends.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Email for fitron.in">
              <Input name="email" type="email" required defaultValue={email} autoComplete="username" />
            </Field>
            <Field label="New fitron.in password" hint="At least 10 characters.">
              <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
            </Field>
            <Field label="Password again">
              <Input name="confirm" type="password" required minLength={10} autoComplete="new-password" />
            </Field>
          </div>
          <div>
            <Button variant="primary">Put the gym on fitron.in</Button>
          </div>
        </form>
      </Card>
    </>
  );
}

async function OnWebsite({ orgId }: { orgId: string }) {
  const [devices, conflicts] = await Promise.all([listDevices(orgId), db.syncConflict.count({ where: { orgId, resolvedAt: null } })]);
  const names = new Map((await db.user.findMany({ where: { id: { in: devices.map((d) => d.linkedById) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  return (
    <>
      <Notice>
        Computers running FITRON for Windows can keep this gym&apos;s books in step with the website. A computer is linked from its own Settings › Cloud sync by a Super Admin. Each one keeps working offline and syncs when the internet is on.
      </Notice>
      {conflicts > 0 && <Notice tone="alert">{conflicts} records were changed on a computer and here at the same time. Both versions are kept; the computer&apos;s Settings › Cloud sync lists them.</Notice>}
      <Card title="Linked computers">
        {!devices.length ? (
          <p className="m-0 text-sm text-muted">No computer is linked to this gym.</p>
        ) : (
          <ScrollRegion label="Linked computers">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Computer</th>
                  <th className={TH}>Linked by</th>
                  <th className={TH}>Linked</th>
                  <th className={TH}>Last seen</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} className={TR}>
                    <td className={TD}>
                      {d.name} <span className="text-muted">#{d.deviceNo}</span>
                    </td>
                    <td className={TD}>{names.get(d.linkedById) ?? "—"}</td>
                    <td className={TD}>{when(d.linkedAt)}</td>
                    <td className={TD}>{d.revokedAt ? <Badge tone="neutral">Unlinked {fmtStamp(d.revokedAt)}</Badge> : when(d.lastSeenAt)}</td>
                    <td className={TD}>
                      {!d.revokedAt && (
                        <form action={revokeDeviceAction}>
                          <input type="hidden" name="id" value={d.id} />
                          <ConfirmButton confirm={`Unlink ${d.name}? It stops syncing at its next try; its records stay on that computer.`}>Unlink</ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </Card>
    </>
  );
}
