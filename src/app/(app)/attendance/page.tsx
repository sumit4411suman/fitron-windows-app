import Link from "next/link";
import QRCode from "qrcode";
import { CaretLeftIcon, CaretRightIcon, DoorOpenIcon, DownloadSimpleIcon, UserCirclePlusIcon, WhatsappLogoIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { busyHours, canOverrideEntry, dailyCounts, getAccessRules, idleMembers, listDay } from "@/lib/services/attendance";
import { appUrl } from "@/lib/services/accounts";
import { memberScope, summarize } from "@/lib/services/members";
import { getSetting } from "@/lib/services/settings";
import { nowHHMM, nowMs, todayIso } from "@/lib/services/time";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { ConfirmButton } from "@/components/confirm-button";
import { Tag } from "@/components/tag";
import { ListHeader, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { fmtClock, fmtDate, fmtStamp, fmtTime, formatRupees } from "@/lib/format";
import { CheckInDesk, GuestForm } from "./attendance-forms";
import { checkOutAction, closeDayAction, removeAction } from "./actions";

export const metadata = { title: "Attendance · Fitron" };

const ghost = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md px-1.5 text-sm font-semibold text-accent hover:bg-accent/10";
const hourLabel = (h: number, long = false) => `${h % 12 || 12}${long ? (h < 12 ? " am" : " pm") : h < 12 ? "a" : "p"}`;
const VISIT: Record<string, string> = { TRIAL: "Trial", GUEST: "Guest", DAY_PASS: "Day pass" };

export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const u = await requirePermission("attendance.manage");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const today = todayIso();
  const date = s("date") && /^\d{4}-\d{2}-\d{2}$/.test(s("date")!) && s("date")! <= today ? s("date")! : today;
  const isToday = date === today;
  const branchId = u.branch !== "ALL" ? u.branch : u.branches[0]?.id;

  const [day, insideNow, trend, hours, idle, rules, gym, devices, activeCount] = await Promise.all([
    listDay(u, date),
    isToday ? null : db.attendance.count({ where: { branchId: { in: u.branchIds }, date: new Date(`${today}T00:00:00Z`), checkOut: null } }),
    dailyCounts(u, 14),
    busyHours(u),
    idleMembers(u),
    getAccessRules(u.orgId),
    getSetting<{ name?: string }>(u.orgId, "gym"),
    db.device.findMany({ where: { orgId: u.orgId, approved: true, branchId: { in: u.branchIds } }, orderBy: { createdAt: "asc" } }),
    (async () => {
      const ms = await db.member.findMany({ where: { ...memberScope(u), walkIn: false, suspended: false }, select: { id: true } });
      const sums = await summarize(ms.map((m) => m.id), today);
      return [...sums.values()].filter((x) => (x.latestEnd ?? "") >= today).length;
    })(),
  ]);
  const inside = isToday ? day.inside : (insideNow ?? 0);
  const gymName = gym?.name || u.orgName;
  const branchName = u.branches.find((b) => b.id === branchId)?.name ?? "";
  const qrText = `${appUrl()}/c/${encodeURIComponent(gymName.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}/${branchId ?? ""}`;
  const qr = await QRCode.toDataURL(qrText, { margin: 0, width: 220 });
  const rulesText = [
    rules.blockExpired ? `expired blocked after ${rules.graceDays} grace days` : "expired allowed",
    rules.blockDues ? `dues above ${formatRupees(rules.duesLimit)} blocked` : "dues not blocked",
    rules.antiPassback ? "anti-passback on" : "re-entry allowed",
    rules.hoursFrom && rules.hoursTo ? `hours ${fmtClock(rules.hoursFrom)} – ${fmtClock(rules.hoursTo)}` : "open all hours",
  ].join(" · ");

  // Day stats (prototype): check-ins, inside now, unique members, average time inside, peak hour, active members.
  const now = nowMs();
  const mins = (a: { checkIn: Date; checkOut: Date | null }) => Math.max(0, Math.round(((a.checkOut?.getTime() ?? now) - a.checkIn.getTime()) / 60000));
  const dur = (n: number) => (n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} m` : ""}`);
  const done = day.rows.filter((r) => r.checkOut);
  const avg = done.length ? Math.round(done.reduce((a, r) => a + mins(r), 0) / done.length) : 0;
  const byHour = new Map<number, number>();
  for (const r of day.rows) {
    const h = Number(nowHHMM(r.checkIn).slice(0, 2));
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  const peak = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const stats: [string, string][] = [
    [isToday ? "Today's check-ins" : "Check-ins", String(day.rows.length)],
    ["In the gym now", String(inside)],
    ["Unique members", String(day.members)],
    ["Avg time inside", done.length ? dur(avg) : "—"],
    ["Peak hour", peak != null ? hourLabel(peak, true) : "—"],
    ["Active members", String(activeCount)],
  ];

  const memberIds = [...new Set(day.rows.map((r) => r.memberId).filter((x): x is string => !!x))];
  const [sums, plans] = await Promise.all([
    summarize(memberIds, today),
    db.membership.findMany({ where: { memberId: { in: memberIds }, status: "VALID" }, orderBy: { endDate: "desc" }, distinct: ["memberId"], select: { memberId: true, plan: { select: { name: true } } } }),
  ]);
  const planOf = new Map(plans.map((p) => [p.memberId, p.plan.name]));
  const maxTrend = Math.max(1, ...trend.map((t) => t.count));
  const maxHour = Math.max(1, ...hours.map((h) => h.count));
  const peakHour = hours.reduce((p, h) => (h.count > p.count ? h : p), hours[0]!);
  const canUndo = isToday && ["Super Admin", "Admin", "Receptionist"].includes(u.role);
  const link = (d: string) => (d === today ? "/attendance" : `/attendance?date=${d}`);

  return (
    <div className="flex flex-col gap-[30px] pt-4">
      <ListHeader
        kicker={new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(/ (\d{4})$/, ", $1")}
        title="Attendance"
        actions={
          <>
            <Link href={`${link(date)}${date === today ? "?" : "&"}guest=1`} className={ghost} scroll={false}>
              <UserCirclePlusIcon weight="duotone" />
              Trial / guest / day pass
            </Link>
            {inside > 0 && (
              <form action={closeDayAction}>
                <ConfirmButton confirm={`Check out the ${inside} people still inside?`} className="gap-1.5">
                  <DoorOpenIcon weight="duotone" />
                  Check out all ({inside})
                </ConfirmButton>
              </form>
            )}
          </>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-x-8 gap-y-[22px]">
        {stats.map(([k, v]) => (
          <div key={k}>
            <div className="text-[11px] tracking-[0.08em] text-muted uppercase">{k}</div>
            <div className="mt-1 text-[28px] leading-[1.15] font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] items-start gap-x-12 gap-y-7">
        <CheckInDesk
          rulesText={rulesText}
          qr={qr}
          qrText={qrText}
          gymName={gymName}
          branchName={branchName}
          canOverride={canOverrideEntry(u)}
          devices={devices.map((d) => {
            const online = !!d.lastSeenAt && now - d.lastSeenAt.getTime() < 10 * 60_000;
            return { name: d.name ?? d.serial, online, sync: d.lastSeenAt ? `synced ${fmtStamp(d.lastSeenAt)}, ${fmtTime(d.lastSeenAt)}` : "not connected" };
          })}
        />
        <div className="flex flex-col gap-[22px]">
          <div>
            <h3 className="mb-3 text-lg">Last 14 days</h3>
            <div className="flex h-[110px] items-end gap-1.5">
              {trend.map((t) => (
                <Link key={t.date} href={link(t.date)} title={`${fmtDate(t.date)}: ${t.count} check-ins`} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-[5px]">
                  <span className="text-center text-[11px] font-semibold">{t.count || ""}</span>
                  <span
                    className={cx("block rounded-t-[2px]", t.date === today ? "bg-accent" : t.date === date ? "bg-accent-700" : "bg-[#6b6355] light:bg-[#978c77]")}
                    style={{ height: `${(t.count / maxTrend) * 100}%` }}
                  />
                  <span className="truncate text-center text-[10px] text-muted">{Number(t.date.slice(8))}</span>
                </Link>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-0.5 text-lg">Busy hours</h3>
            <div className="mb-3 text-xs text-muted">Busiest: {hourLabel(peakHour.hour, true)} · average check-ins per day by hour, last 30 days</div>
            <div className="flex h-[110px] items-end gap-1">
              {hours.map((h) => (
                <div key={h.hour} title={`${hourLabel(h.hour, true)}: ${h.count} check-ins in 30 days`} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
                  <div className="text-center text-[10px] font-semibold">{h.count ? Math.round((h.count / 30) * 10) / 10 : ""}</div>
                  <div className={cx("rounded-t-[2px]", h.hour === peakHour.hour ? "bg-accent" : "bg-[#6b6355] light:bg-[#978c77]")} style={{ height: `${(h.count / maxHour) * 100}%` }} />
                  <div className="truncate text-center text-[10px] text-muted">{hourLabel(h.hour)}</div>
                </div>
              ))}
            </div>
          </div>
          {idle.length > 0 && (
            <div>
              <h3 className="mb-2.5 text-lg">Haven’t visited in 14+ days</h3>
              <div className="flex flex-col">
                {idle.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 border-b border-fg/8 py-2 text-sm">
                    <Link href={`/members/${m.id}`}>
                      <div className="font-semibold">{m.name}</div>
                      <div className="text-xs text-muted">{m.lastVisit ? `Last visit ${fmtDate(m.lastVisit)} · ${daysBetween(today, m.lastVisit)} days ago` : "No visits recorded"}</div>
                    </Link>
                    <a
                      href={`https://wa.me/91${m.phone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(`Hi ${m.name.split(" ")[0]}, we have missed you at ${gymName}! Come in this week and let’s get back on track.`)}`}
                      target="_blank"
                      rel="noopener"
                      className={`${ghost} text-[13px]`}
                    >
                      <WhatsappLogoIcon weight="duotone" />
                      Nudge
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="m-0 text-xl">{isToday ? "Today" : fmtDate(date)}</h3>
            <Link href={link(addDays(date, -1))} aria-label="Previous day" className="grid size-8 place-items-center rounded-md text-accent hover:bg-accent/10">
              <CaretLeftIcon weight="duotone" />
            </Link>
            <form className="contents">
              <input type="date" name="date" defaultValue={date} max={today} aria-label="Day" className="min-h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-fg" />
              <button className="sr-only">Show</button>
            </form>
            {isToday ? (
              <span className="grid size-8 place-items-center text-accent opacity-45">
                <CaretRightIcon weight="duotone" />
              </span>
            ) : (
              <Link href={link(addDays(date, 1))} aria-label="Next day" className="grid size-8 place-items-center rounded-md text-accent hover:bg-accent/10">
                <CaretRightIcon weight="duotone" />
              </Link>
            )}
            {!isToday && (
              <Link href="/attendance" className={`${ghost} text-[13px]`}>
                Today
              </Link>
            )}
          </div>
          <a href={`/attendance/csv?date=${date}`} className="inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">
            <DownloadSimpleIcon weight="duotone" />
            Export CSV
          </a>
        </div>
        <ScrollRegion label="Attendance table">
          <table className={TABLE}>
            <thead>
              <tr>
                {["Member", "Plan / visit", "In", "Out", "Time inside", "Method", "Status", ""].map((h, i) => (
                  <th key={i} className={TH}>
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {day.rows.map((r) => {
                const sm = r.memberId ? sums.get(r.memberId) : null;
                const left = sm?.latestEnd ? daysBetween(sm.latestEnd, today) : null;
                const flag = sm ? (sm.outstanding > 0 ? `${formatRupees(sm.outstanding)} due` : left !== null && left >= 0 && left <= 7 ? `Ends in ${left} d` : "") : "";
                const age = now - r.checkIn.getTime();
                const recent = canUndo && !r.checkOut && age >= 0 && age <= 10 * 60_000;
                return (
                  <tr key={r.id} className={TR}>
                    <td className={cx(TD, "whitespace-nowrap")}>
                      {r.member ? (
                        <Link href={`/members/${r.member.id}`} className="hover:text-accent">
                          <div className="font-semibold">{r.member.name}</div>
                          <div className="text-xs text-muted">{r.member.code}</div>
                        </Link>
                      ) : (
                        <>
                          <div className="font-semibold">{r.guestName}</div>
                          <div className="text-xs text-muted">{r.guestPhone}</div>
                        </>
                      )}
                    </td>
                    <td className={cx(TD, "whitespace-nowrap")}>
                      {r.memberId ? (planOf.get(r.memberId) ?? "—") : (VISIT[r.type] ?? "Guest")}
                      {flag && <div className={cx("text-xs", sm!.outstanding > 0 ? "text-alert-700" : "text-accent-700")}>{flag}</div>}
                    </td>
                    <td className={cx(TD, "whitespace-nowrap")}>{fmtTime(r.checkIn)}</td>
                    <td className={cx(TD, "whitespace-nowrap")}>{r.checkOut ? `${fmtTime(r.checkOut)}${r.autoOut ? " · auto" : ""}` : "—"}</td>
                    <td className={cx(TD, "whitespace-nowrap")}>{dur(mins(r))}</td>
                    <td className={cx(TD, "text-[13px] whitespace-nowrap")}>
                      {r.method}
                      {r.override ? " · allowed by staff" : ""}
                    </td>
                    <td className={TD}>{r.checkOut ? <Tag label="Left" /> : <Tag label="Inside">Inside</Tag>}</td>
                    <td className={cx(TD, "text-right whitespace-nowrap")}>
                      {!r.checkOut && (
                        <form action={checkOutAction.bind(null, r.id)} className="inline">
                          <button className={`${ghost} text-[13px]`}>Check out</button>
                        </form>
                      )}
                      {recent && (
                        <form action={removeAction.bind(null, r.id)} className="inline">
                          <ConfirmButton variant="ghost" className="text-[13px] text-alert-700" confirm="Remove this check-in? Use this only for a wrong entry made just now. The removal is recorded in the audit log.">
                            Undo
                          </ConfirmButton>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
        {day.rows.length === 0 && <div className="py-3 text-sm text-muted">No check-ins on this day.</div>}
      </section>

      {s("guest") && (
        <div className="fixed inset-0 z-50 grid place-items-center p-5 max-lg:items-end max-lg:p-0">
          <Link href={link(date)} aria-label="Close" className="absolute inset-0 bg-black/60" scroll={false} />
          <div role="dialog" aria-modal="true" className="relative flex w-[min(480px,100%)] flex-col gap-3.5 rounded-lg bg-surface p-5 shadow-lg">
            <div>
              <div className="text-[11px] tracking-[0.1em] text-muted uppercase">Attendance</div>
              <div className="text-xl font-semibold">Log trial, guest or day pass</div>
            </div>
            <GuestForm close={link(date)} />
            <p className="m-0 text-[13px] text-muted">Trial visitors are added to Leads automatically for follow-up.</p>
          </div>
        </div>
      )}
    </div>
  );
}
