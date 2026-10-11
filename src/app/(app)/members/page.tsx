import Link from "next/link";
import { ArrowCounterClockwiseIcon, CaretRightIcon, DownloadSimpleIcon, TrashIcon, UploadSimpleIcon, UserPlusIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listDeleted, listMembers, memberScope } from "@/lib/services/members";
import { listPlans } from "@/lib/services/plans";
import { todayIso } from "@/lib/services/time";
import { daysBetween } from "@/lib/domain/dates";
import { LinkButton, Notice, Pager, Select, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { AutoFilter } from "@/components/auto-filter";
import { MemberStatus } from "@/components/status";
import { Tag } from "@/components/tag";
import { fmtDate, fmtStamp, formatRupees, initials } from "@/lib/format";
import { bringBackMember } from "./actions";

export const metadata = { title: "Members · Fitron" };

const PAGE = 12;
const STATUS_OPTS = [
  ["", "All statuses"],
  ["ACTIVE", "Active"],
  ["EXPIRING_SOON", "Expiring soon"],
  ["UPCOMING", "Starts later"],
  ["EXPIRED", "Expired"],
  ["NO_PLAN", "No plan"],
  ["PAYMENT_PENDING", "Payment pending"],
  ["DUE", "Any balance due"],
  ["SUSPENDED", "Suspended"],
  ["RISK", "At risk (AI)"],
] as const;

const left = (end: string | null, today: string) => {
  if (!end) return "No plan yet";
  const d = daysBetween(end, today);
  return d < 0 ? `Expired ${-d} days ago` : d === 0 ? "Ends today" : `${d} days left`;
};

export default async function MembersPage({ searchParams }: PageProps<"/members">) {
  const u = await requirePermission("members.view");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const f = { q: str("q"), status: str("status"), gender: str("gender"), plan: str("plan"), area: str("area"), page: Number(str("page") ?? 1) || 1 };
  const canDelete = u.can("members.delete");
  const [{ rows, total, page }, plans, areas, all, deleted] = await Promise.all([
    listMembers(u, { ...f, pageSize: PAGE }),
    listPlans(u),
    db.member.findMany({ where: { ...memberScope(u), walkIn: false, area: { not: null } }, distinct: ["area"], select: { area: true }, orderBy: { area: "asc" } }),
    db.member.count({ where: { ...memberScope(u), walkIn: false } }),
    canDelete ? listDeleted(u) : [],
  ]);
  const today = todayIso();
  const qs = (p: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== "page")), page: String(p) } as Record<string, string>).toString();
  const branchName = u.branch === "ALL" ? "All branches" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");
  const kicker = u.can("members.all") ? `${all.toLocaleString("en-IN")} members · ${branchName}` : "Assigned to you";
  const showDeleted = str("deleted") === "1";

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] tracking-[0.1em] text-muted uppercase">{kicker}</div>
          <h1 className="mt-1 text-[28px] lg:text-[40px]">Members</h1>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {u.can("members.create") && (
            <LinkButton href="/members/new" variant="primary">
              <UserPlusIcon size={17} weight="duotone" />
              Add member
            </LinkButton>
          )}
          {u.can("import.run") && (
            <LinkButton href="/settings/import">
              <UploadSimpleIcon size={17} weight="duotone" />
              Import
            </LinkButton>
          )}
          <LinkButton href="/reports/members/csv" prefetch={false}>
            <DownloadSimpleIcon size={17} weight="duotone" />
            Export CSV
          </LinkButton>
        </div>
      </div>

      {str("msg") && <Notice tone="ok">{str("msg")}</Notice>}
      {str("error") && <Notice tone="alert">{str("error")}</Notice>}

      <AutoFilter className="flex flex-wrap items-end gap-2.5">
        <input type="hidden" name="page" defaultValue="1" />
        <input
          type="text"
          name="q"
          defaultValue={f.q}
          placeholder="Name, member ID, phone or email"
          aria-label="Search members"
          className="min-h-9 max-w-[360px] flex-[1_1_240px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-fg placeholder:text-fg/65 hover:border-fg/45 focus:border-accent focus:outline-none"
        />
        <Select name="status" defaultValue={f.status ?? ""} aria-label="Status" className="w-auto!">
          {STATUS_OPTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select name="plan" defaultValue={f.plan ?? ""} aria-label="Plan" className="w-auto!">
          <option value="">All plans</option>
          {[...new Set(plans.map((p) => p.name))].sort().map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select name="gender" defaultValue={f.gender ?? ""} aria-label="Gender" className="w-auto!">
          <option value="">All genders</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </Select>
        <Select name="area" defaultValue={f.area ?? ""} aria-label="Area" className="w-auto!">
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a.area} value={a.area!}>
              {a.area}
            </option>
          ))}
        </Select>
      </AutoFilter>

      {rows.length > 0 && (
        <>
          <ScrollRegion label="Members table" className="hidden lg:block">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Member</th>
                  <th className={TH}>Phone</th>
                  <th className={TH}>Plan</th>
                  <th className={TH}>Expiry</th>
                  <th className={TH}>Status</th>
                  <th className={cx(TH, "text-right")}>Outstanding</th>
                  <th className={TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className={cx(TR, "relative cursor-pointer")}>
                    <td className={TD}>
                      <Link href={`/members/${m.id}`} className="flex items-center gap-2.5 after:absolute after:inset-0">
                        <span className="grid size-8 flex-none place-items-center rounded-full bg-neutral-200 text-xs font-semibold">{initials(m.name)}</span>
                        <span>
                          <span className="block">{m.name}</span>
                          <span className="block text-xs text-muted">
                            {m.code}
                            {!m.consentAt && (
                              <>
                                {" "}
                                <Tag label="No consent" style={3} className="ml-1 px-1.5 py-0 text-[10px]" />
                              </>
                            )}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className={cx(TD, "whitespace-nowrap")}>{m.phone}</td>
                    <td className={TD}>{m.planName ?? "—"}</td>
                    <td className={cx(TD, "whitespace-nowrap")}>
                      {fmtDate(m.latestEnd)}
                      <div className="text-xs text-muted">{left(m.latestEnd, today)}</div>
                    </td>
                    <td className={TD}>
                      <MemberStatus status={m.status} />
                    </td>
                    <td className={cx(TD, "text-right whitespace-nowrap")}>{m.outstanding ? formatRupees(m.outstanding) : "—"}</td>
                    <td className={cx(TD, "text-right text-faint")}>
                      <CaretRightIcon weight="duotone" className="inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <div className="flex flex-col lg:hidden">
            {rows.map((m) => (
              <Link key={m.id} href={`/members/${m.id}`} className="flex min-h-14 items-center gap-3 border-b border-fg/8 py-3">
                <span className="grid size-10 flex-none place-items-center rounded-full bg-neutral-200 text-[13px] font-semibold">{initials(m.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px]">{m.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {m.code} · {m.planName ?? "—"} · {fmtDate(m.latestEnd)}
                    {!m.consentAt && " · No consent recorded"}
                  </span>
                </span>
                <MemberStatus status={m.status} />
              </Link>
            ))}
          </div>
        </>
      )}
      {rows.length === 0 && <p className="text-muted">{all ? "No members match these filters." : "No members yet. Add your first member."}</p>}

      <Pager page={page} pageSize={PAGE} total={total} href={(p) => `/members?${qs(p)}`} />

      {deleted.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <Link href={showDeleted ? "/members" : "/members?deleted=1"} className="-ml-2.5 inline-flex py-2.5 leading-[1.2] items-center gap-1.5 self-start rounded-md px-1.5 text-sm font-semibold text-accent hover:bg-accent/10">
            <TrashIcon size={16} weight="duotone" />
            Recently deleted ({deleted.length})
          </Link>
          {showDeleted &&
            deleted.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2.5">
                <div>
                  <div className="text-sm font-semibold">
                    {d.name} <span className="text-xs font-normal text-muted">{d.code}</span>
                  </div>
                  <div className="text-xs text-muted">{d.erasedAt ? `Personal data erased ${fmtStamp(d.erasedAt)}` : `Deleted ${fmtStamp(d.deletedAt)} by ${d.deletedBy}${d.deleteReason ? ` · ${d.deleteReason}` : ""}`}</div>
                </div>
                {!d.erasedAt && (
                  <form action={bringBackMember.bind(null, d.id)}>
                    <button className="inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">
                      <ArrowCounterClockwiseIcon weight="duotone" />
                      Restore
                    </button>
                  </form>
                )}
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
