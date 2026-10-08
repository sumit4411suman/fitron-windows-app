import Link from "next/link";
import { CaretLeftIcon, CaretRightIcon, CheckIcon, ChecksIcon, PlusIcon, WhatsappLogoIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { addDays } from "@/lib/domain/dates";
import { getSession, weekSchedule, weekStart, WEEKDAYS } from "@/lib/services/classes";
import { memberScope, summarize } from "@/lib/services/members";
import { fromIso, nowHHMM, todayIso } from "@/lib/services/time";
import { Tag } from "@/components/tag";
import { LinkButton, ListHeader, Notice, TABLE, TD, TH, cx, ScrollRegion } from "@/components/ui";
import { fmtClock, fmtDate, initials } from "@/lib/format";
import { SessionBook } from "./class-forms";
import { bookingStatusAction, markAllAttendedAction, remindClassAction } from "./actions";

export const metadata = { title: "Classes · Fitron" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const WD = WEEKDAYS.map((d) => d.slice(0, 3));
const ghost = "inline-flex min-h-[34px] items-center gap-1.5 rounded-md px-1.5 text-[13px] font-semibold text-accent hover:bg-accent/10";
const secondary = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7";

/** Fill colour as in the prototype: gold, deeper gold from 70%, pink when full. */
const toneOf = (n: number, cap: number) => (n >= cap ? 2 : cap && n / cap >= 0.7 ? 1 : 0);
const TEXT = ["text-accent", "text-accent-700", "text-alert-700"];
const BAR = ["bg-accent", "bg-accent-700", "bg-alert-700"];
const pct = (n: number, cap: number) => `${cap ? Math.min(100, Math.round((n / cap) * 100)) : 0}%`;

export default async function ClassesPage({ searchParams }: PageProps<"/classes">) {
  const u = await requirePermission("classes.manage");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const today = todayIso();
  const thisWeek = weekStart(today);
  const start = weekStart(str("week") && ISO.test(str("week")!) ? str("week")! : today);
  const end = addDays(start, 6);
  const list = str("view") === "list";
  const base = new URLSearchParams({ ...(start !== thisWeek && { week: start }), ...(list && { view: "list" }) });
  const href = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams(base);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `/classes?${s}` : "/classes";
  };

  const sessions = await weekSchedule(u, start);
  const completed = await db.booking.groupBy({
    by: ["status"],
    where: { classSlot: { orgId: u.orgId, branchId: { in: u.branchIds } }, date: { gte: fromIso(start), lte: fromIso(end) }, status: { in: ["Attended", "No-show"] } },
    _count: { _all: true },
  });
  const done = completed.reduce((a, x) => a + x._count._all, 0);
  const noShows = completed.find((x) => x.status === "No-show")?._count._all ?? 0;

  const booked = sessions.reduce((a, s) => a + s.booked, 0);
  const places = sessions.reduce((a, s) => a + s.capacity, 0);
  const waiting = sessions.reduce((a, s) => a + s.waitlist, 0);
  const todays = sessions.filter((s) => s.date === today);
  const nowHM = nowHHMM();
  const next = todays.find((s) => s.startTime >= nowHM);
  const kpis: [string, string, string][] = [
    ["Classes this week", String(sessions.length), `${new Set(sessions.map((s) => s.trainerId)).size} trainer${new Set(sessions.map((s) => s.trainerId)).size === 1 ? "" : "s"}`],
    ["Booked", String(booked), `of ${places} places`],
    ["Fill rate", places ? `${Math.round((booked / places) * 100)}%` : "—", waiting ? `${waiting} on waitlists` : "no waitlists"],
    ["No-show rate", done ? `${Math.round((noShows / done) * 100)}%` : "—", `${done} completed bookings`],
    ["Today", String(todays.length), next ? `next ${fmtClock(next.startTime)} ${next.name}` : todays.length ? "all done for today" : "no classes today"],
  ];

  // The selected session (?sel=slot&d=date) opens the panel under the timetable.
  const selDate = str("d") && ISO.test(str("d")!) ? str("d")! : undefined;
  const sel = str("sel") && selDate ? await getSession(u, str("sel")!, selDate) : null;
  const panel = sel ? await sessionPanel(u, sel, today) : null;
  const back = sel ? href({ sel: sel.slot.id, d: sel.date, msg: undefined }) : "";
  const backQ = back.includes("?") ? back : `${back}?`;

  return (
    <div className="flex flex-col gap-[26px]">
      <ListHeader
        kicker={`Group classes · ${fmtDate(start)} – ${fmtDate(end)}`}
        title="Classes"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-line">
              <Link href={href({ week: addDays(start, -7), sel: undefined, d: undefined, msg: undefined })} aria-label="Previous week" className="grid h-9 w-9 place-items-center hover:bg-fg/7">
                <CaretLeftIcon size={16} weight="duotone" />
              </Link>
              <Link href={href({ week: undefined, sel: undefined, d: undefined, msg: undefined })} className="grid h-9 place-items-center px-3 text-[13px] font-semibold hover:bg-fg/7">
                This week
              </Link>
              <Link href={href({ week: addDays(start, 7), sel: undefined, d: undefined, msg: undefined })} aria-label="Next week" className="grid h-9 w-9 place-items-center hover:bg-fg/7">
                <CaretRightIcon size={16} weight="duotone" />
              </Link>
            </div>
            <div className="inline-flex overflow-hidden rounded-md border border-line">
              {[
                ["week", "Week"],
                ["list", "List"],
              ].map(([k, label]) => (
                <Link
                  key={k}
                  href={href({ view: k === "list" ? "list" : undefined, msg: undefined })}
                  className={cx("px-3.5 py-[7px] text-[13px] leading-[normal]", (k === "list") === list ? "bg-accent text-accent-ink" : "hover:bg-fg/7")}
                >
                  {label}
                </Link>
              ))}
            </div>
            <LinkButton href="/classes/new" variant="primary">
              <PlusIcon size={16} weight="duotone" />
              New class
            </LinkButton>
          </div>
        }
      />

      <div className="grid gap-x-8 gap-y-[22px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr))]">
        {kpis.map(([k, v, sub]) => (
          <div key={k}>
            <div className="text-[11px] tracking-[0.08em] text-muted uppercase">{k}</div>
            <div className="mt-1 text-[28px] leading-[1.15] font-semibold">{v}</div>
            <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>
          </div>
        ))}
      </div>

      {str("msg") && <Notice tone="ok">{str("msg")}</Notice>}

      {!list ? (
        <ScrollRegion label="Weekly timetable" className="pb-1.5">
          <div className="grid min-w-[1080px] grid-cols-7 gap-2.5">
            {WD.map((label, i) => {
              const date = addDays(start, i);
              const items = sessions.filter((s) => s.weekday === i);
              return (
                <div key={label} className="flex min-w-0 flex-col gap-2 rounded-[14px] bg-surface p-2.5">
                  <div className="flex items-center justify-between gap-1.5 px-0.5 pt-0.5 pb-1.5">
                    <span className="flex items-center gap-2">
                      <span className={cx("grid h-[30px] w-[30px] place-items-center rounded-full text-[13px] font-bold", date === today && "bg-accent text-bg")}>{Number(date.slice(8))}</span>
                      <span className="text-[13px] font-semibold tracking-[0.04em]">{label}</span>
                    </span>
                    <span className="text-[11px] text-muted">{items.length ? `${items.length} class${items.length > 1 ? "es" : ""}` : "—"}</span>
                  </div>
                  {items.map((s) => {
                    const on = sel?.slot.id === s.id && sel.date === date;
                    const tone = toneOf(s.booked, s.capacity);
                    return (
                      <Link
                        key={s.id}
                        href={href({ sel: s.id, d: date, msg: undefined })}
                        scroll={false}
                        className={cx(
                          "flex flex-col gap-2 rounded-xl border px-3 pt-3 pb-2.5 shadow-sm hover:border-accent",
                          on ? "border-accent bg-accent-soft" : "border-line bg-bg",
                          date < today && "opacity-65",
                        )}
                      >
                        <span className="flex items-center justify-between gap-1.5">
                          <span className="text-[12.5px] font-semibold text-accent-strong">{fmtClock(s.startTime)}</span>
                          <span className="text-[11px] text-muted">{s.durationMin} min</span>
                        </span>
                        <span className="text-[15px] leading-[1.2] font-semibold">{s.name}</span>
                        <span className="flex items-center gap-1.5 text-xs text-muted">
                          <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-neutral-200 text-[9.5px] font-bold text-neutral-800">{initials(s.trainerName)}</span>
                          <span className="truncate">{s.trainerName}</span>
                        </span>
                        <span className="flex flex-col gap-1">
                          <span className="flex justify-between text-[11.5px]">
                            <span className={`font-semibold ${TEXT[tone]}`}>
                              {s.booked}/{s.capacity}
                            </span>
                            {s.booked >= s.capacity && date >= today && <span className="font-semibold text-alert-700">Full</span>}
                            {s.waitlist > 0 && <span className="text-muted">{s.waitlist} waiting</span>}
                          </span>
                          <span className="block h-1 rounded-sm bg-fg/15">
                            <span className={`block h-full rounded-sm ${BAR[tone]}`} style={{ width: pct(s.booked, s.capacity) }} />
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                  {!items.length && <div className="rounded-[10px] border border-dashed border-fg/30 px-1.5 py-4 text-center text-xs text-muted">Rest day</div>}
                </div>
              );
            })}
          </div>
        </ScrollRegion>
      ) : sessions.length ? (
        <ScrollRegion label="Class timetable">
          <table className={TABLE}>
            <thead>
              <tr>
                {["Day", "Time", "Class", "Trainer", "Room", "Booked", "Fill", ""].map((h, i) => (
                  <th key={i} className={cx(TH, h === "Fill" && "min-w-[140px]")}>
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const tone = toneOf(s.booked, s.capacity);
                const on = sel?.slot.id === s.id && sel.date === s.date;
                const go = href({ sel: s.id, d: s.date, msg: undefined });
                return (
                  <tr key={s.id} className={cx("hover:bg-fg/4", on && "bg-accent-soft")}>
                    <td className={cx(TD, "whitespace-nowrap")}>
                      <Link href={go} scroll={false}>
                        {WD[s.weekday]} {Number(s.date.slice(8))}
                      </Link>
                    </td>
                    <td className={cx(TD, "whitespace-nowrap")}>
                      {fmtClock(s.startTime)} · {s.durationMin} min
                    </td>
                    <td className={cx(TD, "font-semibold")}>
                      <Link href={go} scroll={false} className="hover:text-accent">
                        {s.name}
                      </Link>
                    </td>
                    <td className={cx(TD, "whitespace-nowrap")}>{s.trainerName}</td>
                    <td className={TD}>{s.room ?? ""}</td>
                    <td className={cx(TD, "font-semibold whitespace-nowrap", TEXT[tone])}>
                      {s.booked}/{s.capacity}
                      {s.waitlist > 0 && <span className="font-normal text-muted"> · {s.waitlist} waiting</span>}
                    </td>
                    <td className={TD}>
                      <span className="block h-1.5 rounded-[3px] bg-fg/15">
                        <span className={`block h-full rounded-[3px] ${BAR[tone]}`} style={{ width: pct(s.booked, s.capacity) }} />
                      </span>
                    </td>
                    <td className={cx(TD, "text-right")}>{s.booked >= s.capacity && s.date >= today && <Tag label="EXPIRED">Full</Tag>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      ) : (
        <div className="text-sm text-muted">No classes scheduled yet.</div>
      )}

      {sel && panel && (
        <section className="grid items-start gap-x-12 gap-y-6 rounded-2xl border border-line bg-surface p-[22px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
          <div className="flex flex-col gap-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] tracking-[0.1em] text-muted uppercase">
                  {WEEKDAYS[sel.slot.weekday]!.slice(0, 3)}, {fmtDate(sel.date)} · {fmtClock(sel.slot.startTime)} · {sel.slot.durationMin} min
                </div>
                <h2 className="mt-1 text-[26px]">{sel.slot.name}</h2>
                <div className="mt-1.5 flex items-center gap-2 text-[13.5px] text-muted">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-neutral-200 text-[10px] font-bold text-neutral-800">{initials(sel.trainerName)}</span>
                  {[sel.trainerName, sel.slot.room].filter(Boolean).join(" · ")}
                </div>
              </div>
              <span className="flex items-center gap-1">
                <Link href={`/classes/${sel.slot.id}?date=${sel.date}`} className={ghost}>
                  Manage
                </Link>
                <Link href={href({ sel: undefined, d: undefined, msg: undefined })} scroll={false} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-md hover:bg-fg/7">
                  <XIcon size={18} weight="duotone" />
                </Link>
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[13.5px]">
                <span className={cx("font-semibold", sel.held >= sel.slot.capacity ? "text-alert-700" : "text-accent")}>
                  {sel.held} of {sel.slot.capacity} places booked{panel.waiting ? ` · ${panel.waiting} on waitlist` : ""}
                </span>
                {sel.date <= today && (
                  <span className="text-muted">
                    {panel.attended} attended · {panel.noShow} no-show
                  </span>
                )}
              </div>
              <div className="h-2 rounded bg-neutral-300">
                <div className={cx("h-full rounded", sel.held >= sel.slot.capacity ? "bg-alert-700" : "bg-accent")} style={{ width: pct(sel.held, sel.slot.capacity) }} />
              </div>
            </div>
            {sel.date >= today && sel.slot.active && <SessionBook slotId={sel.slot.id} date={sel.date} members={panel.bookable} full={sel.held >= sel.slot.capacity} />}
            <div className="flex flex-wrap gap-2">
              {u.can("whatsapp.send") && sel.date >= today && panel.anyBooked && (
                <form action={remindClassAction.bind(null, sel.slot.id, sel.date, backQ)}>
                  <button className={secondary}>
                    <WhatsappLogoIcon size={16} weight="duotone" />
                    Remind everyone
                  </button>
                </form>
              )}
              {sel.date <= today && panel.anyBooked && (
                <form action={markAllAttendedAction.bind(null, sel.slot.id, sel.date, backQ)}>
                  <button className={secondary}>
                    <ChecksIcon size={16} weight="duotone" />
                    Mark all attended
                  </button>
                </form>
              )}
            </div>
            <p className="text-[12.5px] leading-[1.55] text-muted">When a booked member cancels, the first person on the waitlist is moved in and notified on WhatsApp.</p>
          </div>
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[17px]">Roster</h3>
            {panel.roster.length ? (
              <ScrollRegion label="Class bookings">
                <table className={TABLE}>
                  <thead>
                    <tr>
                      {["#", "Member", "Plan", "Status", ""].map((h, i) => (
                        <th key={i} className={TH}>
                          {h || <span className="sr-only">Actions</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {panel.roster.map((b, i) => (
                      <tr key={b.id} className="hover:bg-fg/4">
                        <td className={cx(TD, "text-muted")}>{i + 1}</td>
                        <td className={cx(TD, "whitespace-nowrap")}>
                          <Link href={`/members/${b.member.id}`} className="flex items-center gap-2.5">
                            <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-accent-soft text-[11.5px] font-bold text-accent-strong">{initials(b.member.name)}</span>
                            <span>
                              <span className="block font-semibold">{b.member.name}</span>
                              <span className="block text-xs text-muted">
                                {b.member.code} · {b.member.phone}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className={cx(TD, "text-[13px] whitespace-nowrap")}>{b.plan}</td>
                        <td className={TD}>
                          <Tag label={b.status} />
                        </td>
                        <td className={cx(TD, "text-right whitespace-nowrap")}>
                          <span className="inline-flex gap-1">
                            {b.status === "Booked" && sel.date <= today && (
                              <>
                                <form action={bookingStatusAction.bind(null, b.id, sel.slot.id, "Attended")}>
                                  <button className={ghost}>
                                    <CheckIcon size={14} weight="duotone" />
                                    Attended
                                  </button>
                                </form>
                                <form action={bookingStatusAction.bind(null, b.id, sel.slot.id, "No-show")}>
                                  <button className={ghost}>No-show</button>
                                </form>
                              </>
                            )}
                            {(b.status === "Booked" || b.status === "Waitlist") && sel.date >= today && (
                              <form action={bookingStatusAction.bind(null, b.id, sel.slot.id, "Cancelled")}>
                                <button className={cx(ghost, "text-alert-700")}>Cancel</button>
                              </form>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            ) : (
              <p className="text-sm text-muted">No bookings yet. Pick a member on the left to book the first place.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** The roster (waitlist last, with each member's plan) and the members who can still be booked. */
async function sessionPanel(u: Awaited<ReturnType<typeof requirePermission>>, sel: NonNullable<Awaited<ReturnType<typeof getSession>>>, today: string) {
  const live = sel.bookings.filter((b) => b.status !== "Cancelled").sort((a, b) => Number(a.status === "Waitlist") - Number(b.status === "Waitlist"));
  const inSession = new Set(live.map((b) => b.member.id));
  const pool = sel.date >= today ? await db.member.findMany({ where: { ...memberScope(u), walkIn: false, suspended: false }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }) : [];
  const sums = await summarize([...new Set([...live.map((b) => b.member.id), ...pool.map((m) => m.id)])], today);
  return {
    roster: live.map((b) => ({ ...b, plan: sums.get(b.member.id)?.planName ?? "" })),
    bookable: pool.filter((m) => !inSession.has(m.id) && (sums.get(m.id)?.latestEnd ?? "") >= today).map((m) => ({ code: m.code, name: m.name })),
    waiting: live.filter((b) => b.status === "Waitlist").length,
    attended: live.filter((b) => b.status === "Attended").length,
    noShow: live.filter((b) => b.status === "No-show").length,
    anyBooked: live.some((b) => b.status === "Booked"),
  };
}
