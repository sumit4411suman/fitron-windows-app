import Link from "next/link";
import { headers } from "next/headers";
import { ArrowsClockwiseIcon, DoorOpenIcon, FingerprintIcon, IdentificationCardIcon, InfoIcon, LockKeyIcon, MagnifyingGlassIcon, PlayCircleIcon, PlusIcon, ScanSmileyIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { requireFeature, requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { isDeviceOnline, listDevices, recentAccess } from "@/lib/services/biometric";
import { getAccessRules } from "@/lib/services/attendance";
import { memberScope, summarize } from "@/lib/services/members";
import { membershipStatus } from "@/lib/domain/membership";
import { Dialog, DialogButtons } from "@/components/dialog";
import { LiveRefresh } from "@/components/live-refresh";
import { MemberStatus } from "@/components/status";
import { fromIso, todayIso } from "@/lib/services/time";
import { AutoFilter } from "@/components/auto-filter";
import { Button, Field, Input, LinkButton, Notice, Select, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { Tag } from "@/components/tag";
import { fmtStamp, fmtTime } from "@/lib/format";
import { assignCardAction, enrolAction, eraseAction, openDoorAction, removeDeviceAction, saveDeviceAction, saveRulesAction, syncDeviceAction, testScanAction } from "./actions";

export const metadata = { title: "Biometric & doors · Fitron" };

const box = "flex flex-col gap-3.5 rounded-lg bg-surface p-5";

export default async function DevicesPage({ searchParams }: PageProps<"/settings/devices">) {
  await requirePermission("settings.manage");
  const u = await requireFeature("biometric");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = s("q")?.trim();
  const day = fromIso(todayIso());
  const here = `/settings/devices${q ? `?${new URLSearchParams({ q })}` : ""}`;
  const base = { ...memberScope(u), walkIn: false };
  const [devices, log, branches, rules, entries, denied, total, enrolled, members] = await Promise.all([
    listDevices(u),
    recentAccess(u, 40),
    db.branch.findMany({ where: { id: { in: u.branchIds } }, orderBy: { createdAt: "asc" } }),
    getAccessRules(u.orgId),
    db.accessLog.count({ where: { branchId: { in: u.branchIds }, at: { gte: day }, result: "ALLOWED", method: { not: "Test" } } }),
    db.accessLog.count({ where: { branchId: { in: u.branchIds }, at: { gte: day }, result: "DENIED", method: { not: "Test" } } }),
    db.member.count({ where: base }),
    db.member.findMany({ where: base, select: { id: true, cardNo: true } }).then(async (ms) => {
      const withTpl = new Set((await db.biometricTemplate.groupBy({ by: ["memberId"], where: { memberId: { in: ms.map((m) => m.id) } } })).map((t) => t.memberId));
      return ms.filter((m) => m.cardNo || withTpl.has(m.id)).length;
    }),
    db.member.findMany({
      where: { ...base, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}) },
      select: { id: true, code: true, name: true, devicePin: true, cardNo: true, biometricConsentAt: true, suspended: true },
      orderBy: { name: "asc" },
      take: 30,
    }),
  ]);
  const ids = members.map((m) => m.id);
  const [sums, tpls] = await Promise.all([summarize(ids), db.biometricTemplate.groupBy({ by: ["memberId", "type"], where: { memberId: { in: ids } }, _count: { _all: true } })]);
  const enrolId = s("enrol");
  const cardId = s("card");
  const enrolMember = enrolId ? members.find((m) => m.id === enrolId) ?? (await db.member.findFirst({ where: { ...base, id: enrolId }, select: { id: true, name: true, biometricConsentAt: true } })) : null;
  const cardMember = cardId ? members.find((m) => m.id === cardId) ?? (await db.member.findFirst({ where: { ...base, id: cardId }, select: { id: true, name: true, cardNo: true } })) : null;
  const qs = (p: Record<string, string>) => `/settings/devices?${new URLSearchParams({ ...p, ...(q ? { q } : {}) })}`;
  const enrolDevices = enrolId ? devices.filter((d) => d.approved && d.branchId && u.branchIds.includes(d.branchId)) : [];
  const kind = s("kind") === "FACE" ? "FACE" : "FP";
  const host = (await headers()).get("host") ?? "your-fitron-domain";
  const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "—";
  const isOnline = (d: { lastSeenAt: Date | null }) => isDeviceOnline(d);
  const tpl = (id: string, type: string) => tpls.find((x) => x.memberId === id && x.type === type)?._count._all ?? 0;
  const stats: [string, string, boolean?][] = [
    ["Devices online", `${devices.filter(isOnline).length} / ${devices.length}`],
    ["Members enrolled", `${enrolled} / ${total}`],
    ["Entries today", String(entries)],
    ["Denied today", String(denied), denied > 0],
  ];

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs tracking-[0.04em] text-muted uppercase">Access control</div>
          <h1 className="mt-1 text-[28px] lg:text-[40px]">Biometric &amp; doors</h1>
          <div className="mt-1 text-sm text-muted">Face, fingerprint and RFID entry with automatic door rules</div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <LinkButton href="/settings/devices?add=1#add" variant="primary">
            <PlusIcon size={17} weight="duotone" />
            Add device
          </LinkButton>
        </div>
      </div>
      {s("saved") && <Notice tone="ok">{s("saved")}</Notice>}
      {s("error") && !enrolId && !cardId && <Notice tone="alert">{s("error")}</Notice>}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3.5">
        {stats.map(([k, v, alert]) => (
          <div key={k} className="flex flex-col gap-2 rounded-lg bg-surface px-5 py-[18px]">
            <span className="text-xs tracking-[0.04em] text-muted uppercase">{k}</span>
            <span className={cx("text-[30px] leading-[1.1] font-semibold", alert && "text-alert-700")}>{v}</span>
          </div>
        ))}
      </div>

      {s("add") && (
        <section id="add" className={box}>
          <h3 className="text-[17px]">Add or edit a device</h3>
          <form action={saveDeviceAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <Field label="Serial number" hint="On the label, or Menu › System info › Device info.">
              <Input name="serial" required placeholder="e.g. CQUJ224760123" />
            </Field>
            <Field label="Name">
              <Input name="name" required placeholder="Main door" />
            </Field>
            <Field label="Branch">
              <Select name="branchId" defaultValue={u.branch === "ALL" ? branches[0]?.id : u.branch}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Door open time (seconds)">
              <Input name="relaySeconds" type="number" min={1} max={60} defaultValue={5} />
            </Field>
            <div>
              <Button variant="primary">Save device</Button>
            </div>
          </form>
        </section>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-5">
        <section className={box}>
          <div className="flex items-center justify-between">
            <h3 className="text-[17px]">Devices</h3>
            <span className="text-xs text-muted">ZKTeco / eSSL · ADMS push</span>
          </div>
          {devices.length === 0 && <p className="text-sm text-muted">No devices yet. Add one, then point it at this server.</p>}
          {devices.map((d) => (
            <div key={d.id} className="flex flex-col gap-2.5 rounded-md bg-bg p-3.5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 flex-none place-items-center rounded-[10px] bg-accent-soft">
                  <ScanSmileyIcon size={22} weight="duotone" className="text-accent" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">{d.name ?? d.serial}</div>
                  <div className="truncate text-xs text-muted">
                    {d.model ?? "Device"} · {d.serial} · {branchName(d.branchId)}
                    {d.ip ? ` · ${d.ip}` : ""}
                  </div>
                </div>
                <Tag label={isOnline(d) ? "Online" : "Offline"} />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <ArrowsClockwiseIcon size={14} weight="duotone" />
                  {d.lastSeenAt ? `last seen ${fmtStamp(d.lastSeenAt)}, ${fmtTime(d.lastSeenAt)}` : "never called in"}
                  {d.queued ? ` · ${d.queued} waiting` : ""}
                </span>
                <span className="flex items-center gap-1.5">
                  <LockKeyIcon size={14} weight="duotone" />
                  Door opens {d.relaySeconds} s
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <form action={openDoorAction.bind(null, d.id)}>
                  <Button>
                    <DoorOpenIcon size={16} weight="duotone" />
                    Open door
                  </Button>
                </form>
                <form action={syncDeviceAction.bind(null, d.id)}>
                  <Button variant="ghost">
                    <ArrowsClockwiseIcon size={16} weight="duotone" />
                    Sync
                  </Button>
                </form>
                <form action={removeDeviceAction.bind(null, d.id)}>
                  <ConfirmButton variant="ghost" className="text-alert-700" confirm="Remove this device? It stops letting members in until it is added again.">
                    Remove
                  </ConfirmButton>
                </form>
              </div>
            </div>
          ))}
          <div className="flex items-start gap-2.5 rounded-md border border-dashed border-fg/30 px-3.5 py-3 text-[13px] leading-relaxed">
            <InfoIcon size={18} weight="duotone" className="flex-none text-accent" />
            <span>
              On the device open <strong>Menu › Comm › Cloud Server</strong>. Server <strong>{host}</strong>, port 443, HTTPS on. Save and restart; it shows Online within a minute. Members with an active plan are loaded onto it, and anyone who expires is removed each morning.
            </span>
          </div>
        </section>
        <section className={box}>
          <h3 className="text-[17px]">Door access rules</h3>
          <form action={saveRulesAction} className="flex flex-col">
            {(
              [
                ["blockExpired", "Block expired memberships after the grace period", rules.blockExpired],
                ["blockDues", "Block members whose unpaid balance is above the limit", rules.blockDues],
                ["blockSuspended", "Block suspended members", rules.blockSuspended],
                ["antiPassback", "Anti-passback: no second entry without an exit", rules.antiPassback],
              ] as const
            ).map(([name, label, on]) => (
              <label key={name} className="flex cursor-pointer items-center justify-between gap-3 border-b border-line py-[11px] text-sm">
                <span>{label}</span>
                <input type="checkbox" name={name} defaultChecked={on} className="size-[18px] flex-none accent-accent" />
              </label>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Grace days after expiry" hint="Also under Settings › Reminders.">
                <Input name="graceDays" type="number" min={0} max={60} defaultValue={rules.graceDays} />
              </Field>
              <Field label="Dues limit (₹)">
                <Input name="duesLimit" inputMode="decimal" defaultValue={rules.duesLimit / 100} />
              </Field>
              <Field label="Doors open" hint="Empty = open all hours">
                <Input name="hoursFrom" type="time" defaultValue={rules.hoursFrom ?? ""} />
              </Field>
              <Field label="Doors close">
                <Input name="hoursTo" type="time" defaultValue={rules.hoursTo ?? ""} />
              </Field>
            </div>
            <div className="mt-3">
              <Button variant="primary">Save rules</Button>
            </div>
          </form>
          <div className="text-xs text-muted">Rules are pushed to every device and still apply if the internet drops. A refused member sees the reason on the device; the front desk is notified.</div>
        </section>
      </div>

      <section className={box}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[17px]">Live access log</h3>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="size-2 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]" />
            Updates as members scan
            <LiveRefresh />
          </span>
        </div>
        {log.length === 0 ? (
          <p className="text-sm text-muted">No punches yet.</p>
        ) : (
          <div className="flex max-h-[420px] flex-col overflow-auto">
            {log.map((l) => (
              <div key={l.id} className="grid grid-cols-[86px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-2.5">
                <span className="text-xs whitespace-nowrap text-muted">
                  {fmtTime(l.at)}
                  <span className="block">{fmtStamp(l.at)}</span>
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {!l.member && l.method === "Remote" ? (
                      "Staff"
                    ) : l.member ? (
                      <Link href={`/members/${l.member.id}`} className="hover:text-accent">
                        {l.member.name}
                      </Link>
                    ) : (
                      `PIN ${l.pin}`
                    )}{" "}
                    <span className="text-xs font-normal text-muted">{l.member?.code}</span>
                  </div>
                  <div className="truncate text-xs text-muted">
                    {l.method} · {l.device?.name ?? l.device?.serial}
                    {l.reason ? ` · ${l.reason}` : ""}
                  </div>
                </div>
                <Tag label={l.result === "ALLOWED" ? "Granted" : l.result === "DENIED" ? "Denied" : "Unknown"} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={box}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[17px]">Member enrolment</h3>
            <div className="mt-0.5 text-xs text-muted">Press Face or Finger, then the member looks at the camera or places a finger three times.</div>
          </div>
          <AutoFilter className="relative w-full max-w-[280px]">
            <MagnifyingGlassIcon size={16} weight="duotone" className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input type="text" name="q" defaultValue={q} placeholder="Search name, ID or phone" aria-label="Search members" className="min-h-9 w-full rounded-md border border-line bg-bg py-1.5 pr-2.5 pl-9 text-fg placeholder:text-fg/65 focus:border-accent focus:outline-none" />
          </AutoFilter>
        </div>
        {members.length === 0 ? (
          <p className="text-sm text-muted">{q ? "No member matches." : "No members yet. Add members first, then enrol them here."}</p>
        ) : (
          <ScrollRegion label="Devices table">
            <table className={cx(TABLE, "min-w-[720px]")}>
              <thead>
                <tr>
                  {["Member", "Status", "Face", "Fingerprint", "RFID card"].map((h) => (
                    <th key={h} className={TH}>
                      {h}
                    </th>
                  ))}
                  <th className={cx(TH, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const face = tpl(m.id, "FACE");
                  const fp = tpl(m.id, "FP");
                  return (
                    <tr key={m.id} className={TR}>
                      <td className={cx(TD, "whitespace-nowrap")}>
                        <div className="font-semibold">{m.name}</div>
                        <div className="text-xs text-muted">{m.code}</div>
                      </td>
                      <td className={TD}>
                        <MemberStatus status={membershipStatus({ suspended: m.suspended, latestEnd: sums.get(m.id)!.latestEnd, outstanding: sums.get(m.id)!.outstanding, today: todayIso() })} />
                      </td>
                      <td className={cx(TD, "whitespace-nowrap", face ? "text-accent" : "text-muted")}>
                        <ScanSmileyIcon size={16} weight="duotone" className="mr-1 inline" />
                        {face ? "Enrolled" : "—"}
                      </td>
                      <td className={cx(TD, "whitespace-nowrap", fp ? "text-accent" : "text-muted")}>
                        <FingerprintIcon size={16} weight="duotone" className="mr-1 inline" />
                        {fp ? "Enrolled" : "—"}
                      </td>
                      <td className={cx(TD, "text-[13px] whitespace-nowrap")}>{m.cardNo ?? "—"}</td>
                      <td className={cx(TD, "text-right")}>
                        <span className="inline-flex gap-0.5">
                          <Link href={`${qs({ enrol: m.id, kind: "FACE" })}#enrol`} title="Enrol face" aria-label="Enrol face" className="inline-flex size-9 items-center justify-center rounded-md text-fg hover:bg-fg/7">
                            <ScanSmileyIcon size={18} weight="duotone" />
                          </Link>
                          <Link href={`${qs({ enrol: m.id, kind: "FP" })}#enrol`} title="Enrol fingerprint" aria-label="Enrol fingerprint" className="inline-flex size-9 items-center justify-center rounded-md text-fg hover:bg-fg/7">
                            <FingerprintIcon size={18} weight="duotone" />
                          </Link>
                          <Link href={`${qs({ card: m.id })}#card`} title="Assign RFID card" aria-label="Assign RFID card" className="inline-flex size-9 items-center justify-center rounded-md text-fg hover:bg-fg/7">
                            <IdentificationCardIcon size={18} weight="duotone" />
                          </Link>
                          <form action={testScanAction.bind(null, m.id)}>
                            <button title="Test a scan at the door" aria-label="Test a scan at the door" className="inline-flex size-9 items-center justify-center rounded-md text-fg hover:bg-fg/7">
                              <PlayCircleIcon size={18} weight="duotone" />
                            </button>
                          </form>
                          {(m.devicePin || m.biometricConsentAt || m.cardNo) && (
                            <form action={eraseAction.bind(null, m.id)}>
                              <ConfirmButton variant="ghost" title="Remove biometric data" aria-label="Remove biometric data" className="size-9 !min-h-0 !px-0 text-alert-700" confirm="Face and fingerprint templates and the RFID card are deleted from all devices. Attendance history is kept.">
                                <TrashIcon size={18} weight="duotone" />
                              </ConfirmButton>
                            </form>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>

      {enrolMember && (
        <Dialog kicker={enrolMember.name} title={kind === "FACE" ? "Enrol face" : "Enrol fingerprint"} close={here} error={s("error")} note={enrolDevices.length ? `The member then looks at the camera / places a finger three times on the device.` : undefined}>
          {enrolDevices.length === 0 ? (
            <>
              <p className="m-0 text-sm">No device yet. Add a device first.</p>
              <div className="flex justify-end">
                <LinkButton href={here}>Cancel</LinkButton>
              </div>
            </>
          ) : (
            <form action={enrolAction} id="enrol" className="flex flex-col gap-3.5">
              <input type="hidden" name="memberId" value={enrolMember.id} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="q" value={q ?? ""} />
              <Field label="Device">
                <Select name="deviceId" defaultValue={enrolDevices[0].id}>
                  {enrolDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name ?? d.serial}
                      {isOnline(d) ? "" : " (offline)"}
                    </option>
                  ))}
                </Select>
              </Field>
              {!enrolMember.biometricConsentAt && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="consent" className="mt-0.5 size-4" />
                  <span>The member has given written consent to store their fingerprint or face for gym entry, and knows they can ask for it to be deleted.</span>
                </label>
              )}
              <DialogButtons close={here} label={kind === "FACE" ? "Enrol face" : "Enrol fingerprint"} />
            </form>
          )}
        </Dialog>
      )}
      {cardMember && (
        <Dialog kicker={cardMember.name} title="RFID card" close={here} error={s("error")} note="Leave it empty to take the card away.">
          <form action={assignCardAction} id="card" className="flex flex-col gap-3.5">
            <input type="hidden" name="memberId" value={cardMember.id} />
            <input type="hidden" name="q" value={q ?? ""} />
            <Field label="Card number">
              <Input name="card" inputMode="numeric" placeholder="Tap card on the device or type the number" defaultValue={s("card") && "cardNo" in cardMember ? (cardMember.cardNo ?? "") : ""} autoFocus />
            </Field>
            <DialogButtons close={here} label="Save card" />
          </form>
        </Dialog>
      )}
    </div>
  );
}
