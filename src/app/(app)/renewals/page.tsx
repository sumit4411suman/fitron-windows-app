import Link from "next/link";
import { WhatsappLogoIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { listMembers } from "@/lib/services/members";
import { lastRenewalReminders, renewalAmounts } from "@/lib/services/reminders";
import { reminderSchedule } from "@/lib/services/reminders";
import { getWaSettings } from "@/lib/services/whatsapp";
import { todayIso } from "@/lib/services/time";
import { daysBetween } from "@/lib/domain/dates";
import { Tag } from "@/components/tag";
import { ListHeader, Notice, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { fmtDate, fmtShort, formatRupees } from "@/lib/format";
import { remindRenewalAction, remindRenewalsAction } from "../reminder-actions";

export const metadata = { title: "Renewals · Fitron" };

// The prototype's windows (V.ren): each card counts members whose last membership ends in it.
const BUCKETS: [string, string, (d: number) => boolean][] = [
  ["0", "Today", (d) => d === 0],
  ["1", "Tomorrow", (d) => d === 1],
  ["3", "Within 3 days", (d) => d >= 0 && d <= 3],
  ["7", "Within 7 days", (d) => d >= 0 && d <= 7],
  ["15", "Within 15 days", (d) => d >= 0 && d <= 15],
  ["expired", "Expired · 60 days", (d) => d < 0 && d >= -60],
];
const SHORT: Record<string, string> = { exp15: "15 days", exp7: "7 days", exp3: "3 days", exp1: "1 day", expired: "Expiry message" };

export default async function RenewalsPage({ searchParams }: PageProps<"/renewals">) {
  const u = await requirePermission("memberships.renew");
  const sp = await searchParams;
  const w = typeof sp.w === "string" ? (sp.w === "lapsed" ? "expired" : sp.w) : "7";
  const cur = BUCKETS.find((b) => b[0] === w) ?? BUCKETS[3]!;
  const msg = typeof sp.msg === "string" ? sp.msg : null;
  const today = todayIso();
  const [{ rows: all }, wa, schedule0] = await Promise.all([listMembers(u, { all: true }), getWaSettings(u.orgId), reminderSchedule(u.orgId)]);
  const withDays = all.filter((m) => m.latestEnd).map((m) => ({ ...m, days: daysBetween(m.latestEnd!, today) }));
  const rows = withDays.filter((m) => cur[2](m.days)).sort((a, b) => (a.days < 0 && b.days < 0 ? b.days - a.days : a.days - b.days));
  const ids = rows.map((m) => m.id);
  const [last, amounts] = await Promise.all([lastRenewalReminders(ids), renewalAmounts(ids)]);
  const here = `/renewals?w=${cur[0]}`;
  const schedule = [...schedule0.expiryDays]
    .sort((a, b) => b - a)
    .map((d) => (d === 0 ? "on expiry day" : `${d} day${d > 1 ? "s" : ""} before`))
    .join(", ");
  const canWa = u.can("whatsapp.send");

  return (
    <div className="flex flex-col gap-6 pt-4">
      <ListHeader
        kicker="Automatic expiry tracking"
        title="Renewals"
        actions={
          canWa && (
            <form action={remindRenewalsAction.bind(null, ids, here)}>
              <button disabled={!rows.length} className="inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md bg-accent px-[18px] text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-45">
                <WhatsappLogoIcon size={17} weight="duotone" />
                Remind all ({rows.length})
              </button>
            </form>
          )
        }
      />
      {msg && <Notice tone="ok">{msg}</Notice>}
      <div className="grid auto-cols-[minmax(104px,1fr)] grid-flow-col gap-2.5 overflow-x-auto">
        {BUCKETS.map(([k, label, test]) => (
          <Link key={k} href={`/renewals?w=${k}`} className={cx("rounded-md px-3.5 py-3 text-left leading-[normal]", k === cur[0] ? "bg-accent text-accent-ink" : "bg-surface text-fg hover:bg-surface-2")}>
            <div className="text-xs">{label}</div>
            <div className="text-[26px] font-semibold">{withDays.filter((m) => test(m.days)).length}</div>
          </Link>
        ))}
      </div>
      <p className="m-0 text-[13px] text-muted">
        Reminder schedule: {schedule}. The same reminder is not sent to a member twice within {wa.dedupDays} days.
      </p>
      <ScrollRegion label="Renewals table">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Member</th>
              <th className={TH}>Plan</th>
              <th className={TH}>Expiry</th>
              <th className={TH}>Status</th>
              <th className={TH}>Last reminder</th>
              <th className={cx(TH, "text-right")}>Renewal amount</th>
              <th className={TH}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const l = last.get(m.id);
              return (
                <tr key={m.id} className={TR}>
                  <td className={TD}>
                    <Link href={`/members/${m.id}`} className="hover:text-accent">
                      <span className="block">{m.name}</span>
                      <span className="block text-xs text-muted">
                        {m.code} · {m.phone}
                      </span>
                    </Link>
                  </td>
                  <td className={TD}>{m.planName ?? "—"}</td>
                  <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(m.latestEnd)}</td>
                  <td className={TD}>
                    <Tag label={m.days < 0 ? "EXPIRED" : "EXPIRING SOON"}>
                      {m.days < 0 ? `Expired ${-m.days}d ago` : m.days === 0 ? "Today" : m.days === 1 ? "Tomorrow" : `In ${m.days} days`}
                    </Tag>
                  </td>
                  <td className={cx(TD, "text-[13px]")}>{l ? `${SHORT[l.templateKey] ?? l.templateKey} · ${fmtShort(isoOf(l.sentAt))} · ${l.status}` : "None yet"}</td>
                  <td className={cx(TD, "text-right")}>{formatRupees(amounts.get(m.id) ?? 0)}</td>
                  <td className={cx(TD, "text-right whitespace-nowrap")}>
                    <span className="inline-flex items-center gap-1">
                      {canWa && (
                        <form action={remindRenewalAction.bind(null, m.id, here)}>
                          <button className="inline-flex py-2.5 leading-[1.2] items-center rounded-md px-1.5 text-sm font-semibold text-accent hover:bg-accent/10">Remind</button>
                        </form>
                      )}
                      <Link href={`/members/${m.id}/sell`} className="inline-flex py-2.5 leading-[1.2] items-center rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">
                        Renew
                      </Link>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      {rows.length === 0 && <p className="text-muted">No members in this window.</p>}
    </div>
  );
}

/** The IST date of a timestamp as YYYY-MM-DD. */
const isoOf = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
