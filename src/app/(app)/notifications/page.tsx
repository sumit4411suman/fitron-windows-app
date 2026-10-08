import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ArrowsClockwiseIcon,
  BellIcon,
  CakeIcon,
  CalendarXIcon,
  DatabaseIcon,
  DoorOpenIcon,
  FunnelIcon,
  GearSixIcon,
  HourglassMediumIcon,
  PackageIcon,
  RepeatIcon,
  SparkleIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { requireUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listNotifications, markAllRead, openNotification } from "@/lib/services/notifications";
import { listMembers, memberScope } from "@/lib/services/members";
import { todayIso } from "@/lib/services/time";
import { reminderSchedule } from "@/lib/services/reminders";
import { daysBetween } from "@/lib/domain/dates";
import { ListHeader, cx } from "@/components/ui";
import { fmtDate, fmtShort, fmtTime } from "@/lib/format";

export const metadata = { title: "Notifications · Fitron" };

const TYPE: Record<string, [string, Icon]> = {
  LOW_STOCK: ["Low stock", PackageIcon],
  WAITLIST: ["Class waitlist", UsersThreeIcon],
  CHECKIN_OVERRIDE: ["Check-in override", DoorOpenIcon],
  LEAD_FOLLOW_UP: ["Lead follow-ups", FunnelIcon],
  WA_FAILED: ["WhatsApp failed", WarningCircleIcon],
  AUTOPAY: ["Autopay", RepeatIcon],
  JOB_FAILED: ["Scheduled job failed", GearSixIcon],
  AI_BRIEF: ["Fitron AI brief", SparkleIcon],
  BILLING: ["Fitron billing", ArrowsClockwiseIcon],
  BACKUP_DUE: ["Backup due", DatabaseIcon],
};
const ALERTING = /fail|^Low |override/i;

async function readAll() {
  "use server";
  const u = await requireUser();
  await markAllRead(u);
  revalidatePath("/", "layout");
}

async function open(id: string) {
  "use server";
  const u = await requireUser();
  const link = await openNotification(u, id);
  revalidatePath("/", "layout");
  if (link?.startsWith("/")) redirect(link);
}

/** "Today, 7:05 am" / "Yesterday, 6:30 pm" / "28 Sep, 9:00 am", as in the prototype. */
function when(at: Date, today: string) {
  const day = todayIso(at);
  const d = daysBetween(today, day);
  return `${d === 0 ? "Today" : d === 1 ? "Yesterday" : fmtShort(day)}, ${fmtTime(at)}`;
}

type Row = { key: string; type: string; icon: Icon; when: string; at: number; text: string; unread: boolean; href?: string; formId?: string };

export default async function NotificationsPage() {
  const u = await requireUser();
  const today = todayIso();
  const stored = await listNotifications(u);
  const rows: Row[] = stored.map((n) => {
    const [label, icon] = TYPE[n.type] ?? ["Alert", BellIcon];
    return { key: n.id, type: label, icon, when: when(n.createdAt, today), at: n.createdAt.getTime(), text: n.text, unread: !n.readAt, formId: n.id };
  });

  // Alerts the prototype works out from today's data; shown as read, so they don't add to the count.
  if (u.can("members.view")) {
    const { rows: members } = await listMembers(u, { all: true });
    const morning = (hh: number) => new Date(`${today}T${String(hh).padStart(2, "0")}:00:00+05:30`);
    for (const m of members) {
      if (!m.latestEnd || m.status === "SUSPENDED") continue;
      const left = daysBetween(m.latestEnd, today);
      if (left === 0 || left === 1)
        rows.push({ key: `ex-${m.id}`, type: "Membership expiring", icon: HourglassMediumIcon, when: when(morning(7), today), at: morning(7).getTime(), text: `${m.name}’s ${m.planName ?? ""} membership ends ${left === 0 ? "today" : "tomorrow"}.`, unread: false, href: `/members/${m.id}` });
      if (left < 0 && left >= -3) {
        const at = new Date(`${m.latestEnd}T23:59:00+05:30`);
        rows.push({ key: `xp-${m.id}`, type: "Membership expired", icon: CalendarXIcon, when: when(at, today), at: at.getTime(), text: `${m.name}’s membership expired on ${fmtDate(m.latestEnd)}.`, unread: false, href: `/members/${m.id}` });
      }
    }
    const md = today.slice(5);
    const wishes = (await reminderSchedule(u.orgId)).birthdays;
    const birthdays = await db.member.findMany({ where: { ...memberScope(u), walkIn: false, dob: { not: null } }, select: { id: true, name: true, dob: true } });
    for (const b of birthdays.filter((x) => x.dob!.toISOString().slice(5, 10) === md))
      rows.push({ key: `bd-${b.id}`, type: "Birthday", icon: CakeIcon, when: when(morning(6), today), at: morning(6).getTime(), text: `${b.name} has a birthday today.${wishes ? " Wishes are sent automatically." : ""}`, unread: false, href: `/members/${b.id}` });
  }
  rows.sort((a, b) => b.at - a.at);
  const shown = rows.slice(0, 80);
  const unread = stored.filter((n) => !n.readAt).length;

  return (
    <div className="flex max-w-[780px] flex-col gap-5 pt-4">
      <ListHeader
        kicker={`${unread} unread`}
        title="Notifications"
        actions={
          <form action={readAll}>
            <button className="inline-flex py-2.5 leading-[1.2] items-center rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">Mark all read</button>
          </form>
        }
      />
      <div className="flex flex-col">
        {shown.map((n) => {
          const body = (
            <>
              <n.icon size={22} weight="duotone" className={cx("mt-0.5 flex-none", !n.unread ? "text-faint" : ALERTING.test(n.type) ? "text-alert-700" : "text-accent")} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs tracking-[0.06em] text-muted uppercase">
                  {n.type} · {n.when}
                </span>
                <span className={cx("block text-[15px]", n.unread && "font-semibold")}>{n.text}</span>
              </span>
              {n.unread && <span className="mt-2 size-2 flex-none rounded-full bg-alert" />}
            </>
          );
          const cls = "flex w-full items-start gap-3.5 border-b border-fg/8 py-3 text-left leading-[normal]";
          return n.formId ? (
            <form key={n.key} action={open.bind(null, n.formId)}>
              <button className={cls}>{body}</button>
            </form>
          ) : n.href ? (
            <Link key={n.key} href={n.href} className={cls}>
              {body}
            </Link>
          ) : (
            <div key={n.key} className={cls}>
              {body}
            </div>
          );
        })}
        {shown.length === 0 && <p className="text-muted">No notifications yet.</p>}
      </div>
    </div>
  );
}
