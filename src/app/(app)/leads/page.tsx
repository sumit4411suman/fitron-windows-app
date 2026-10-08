import Link from "next/link";
import type { ReactNode } from "react";
import { BellRingingIcon, CalendarCheckIcon, CheckCircleIcon, ClockIcon, DownloadSimpleIcon, PlusIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listPlans } from "@/lib/services/plans";
import { getSetting } from "@/lib/services/settings";
import { todayIso, toIso } from "@/lib/services/time";
import { daysBetween } from "@/lib/domain/dates";
import { LEAD_STAGES, type LeadStage } from "@/lib/validation/frontdesk";
import { SOURCES } from "@/lib/validation/member";
import { AutoFilter } from "@/components/auto-filter";
import { LinkButton, ListHeader, SEARCH, Segmented, Select, TABLE, TD, TH, cx, ScrollRegion } from "@/components/ui";
import { fmtShort, formatRupees, initials } from "@/lib/format";
import { LeadActions } from "./lead-actions";

export const metadata = { title: "Leads & trials · Fitron" };

const ACTIVE = (stage: string) => stage !== "Won" && stage !== "Lost";
// Stage dots (prototype STC).
const STAGE_COLOR: Record<string, string> = {
  New: "var(--accent)",
  Contacted: "var(--accent-hover)",
  "Trial booked": "var(--accent-700)",
  "Trial done": "var(--accent-strong)",
  Won: "#2e9e63",
  Lost: "var(--alert-700)",
};

type Lead = Awaited<ReturnType<typeof db.lead.findMany>>[number];

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const u = await requirePermission("leads.manage");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const q = (s("q") ?? "").trim().toLowerCase();
  const src = s("source") ?? "";
  const view = s("view") === "list" ? "list" : "board";
  const today = todayIso();

  const [L, plans, gym] = await Promise.all([
    db.lead.findMany({ where: { orgId: u.orgId, branchId: { in: u.branchIds } }, orderBy: { createdAt: "desc" } }),
    listPlans(u),
    getSetting<{ name?: string }>(u.orgId, "gym"),
  ]);
  const gymName = gym?.name || u.orgName;
  const price = (l: Lead) => plans.find((p) => p.name.toLowerCase() === l.interest.toLowerCase())?.price ?? 0;
  const fu = (l: Lead) => (l.followUpOn ? toIso(l.followUpOn) : null);
  const isDue = (l: Lead) => ACTIVE(l.stage) && !!fu(l) && fu(l)! <= today;
  const monthStart = `${today.slice(0, 7)}-01`;
  const created = (l: Lead) => todayIso(l.createdAt);

  const open = L.filter((l) => ACTIVE(l.stage));
  const won = L.filter((l) => l.stage === "Won").length;
  const closed = L.length - open.length;
  const due = L.filter(isDue);
  const trialsToday = L.filter((l) => l.stage === "Trial booked" && l.trialOn && toIso(l.trialOn) === today);
  const newThisMonth = L.filter((l) => created(l) >= monthStart);
  const kpis: [string, string, string, boolean?][] = [
    ["Open leads", open.length.toLocaleString("en-IN"), `${formatRupees(open.reduce((a, l) => a + price(l), 0))} if they all join`],
    ["New this month", String(newThisMonth.length), `${newThisMonth.filter((l) => l.stage === "Won").length} already joined`],
    ["Follow-ups due", String(due.length), due.length ? "call or message today" : "all caught up", due.length > 0],
    ["Trials today", String(trialsToday.length), trialsToday.length ? trialsToday.map((l) => l.name.split(" ")[0]).slice(0, 3).join(", ") : "none scheduled"],
    ["Conversion", closed ? `${Math.round((won / closed) * 100)}%` : "—", `${won} joined of ${closed} closed`],
  ];

  const LF = L.filter((l) => (!src || l.source === src) && (!q || `${l.name} ${l.phone} ${l.notes ?? ""}`.toLowerCase().includes(q)));
  const bySrc = new Map<string, { n: number; w: number }>();
  for (const l of L) bySrc.set(l.source, { n: (bySrc.get(l.source)?.n ?? 0) + 1, w: (bySrc.get(l.source)?.w ?? 0) + (l.stage === "Won" ? 1 : 0) });
  const maxSrc = Math.max(1, ...[...bySrc.values()].map((x) => x.n));

  const info = (l: Lead) => {
    const d = fu(l);
    const dueNow = isDue(l);
    const text =
      l.stage === "Won" ? "Joined" : l.stage === "Lost" ? `Lost · ${l.lostReason || "no reason given"}` : d ? (d === today ? "Follow up today" : dueNow ? `Overdue · ${fmtShort(d)}` : `Follow up ${fmtShort(d)}`) : "No follow-up set";
    const age = daysBetween(today, todayIso(l.stageAt));
    return {
      text,
      tone: dueNow ? "due" : l.stage === "Won" ? "won" : "plain",
      icon: dueNow ? WarningCircleIcon : l.stage === "Won" ? CheckCircleIcon : l.stage === "Lost" ? XCircleIcon : ClockIcon,
      age: age <= 0 ? "today" : `${age}d`,
      trial: l.stage === "Trial booked" && l.trialOn ? `Trial ${fmtShort(l.trialOn)}${toIso(l.trialOn) === today ? " · today" : ""}` : null,
      message: `Hi ${l.name.split(" ")[0]}, thanks for your interest in ${gymName}. When would you like to come in for a free trial session?`,
    };
  };
  const link = (o: { view?: string }) => {
    const p = new URLSearchParams();
    if (s("q")) p.set("q", s("q")!);
    if (src) p.set("source", src);
    const v = o.view ?? view;
    if (v === "list") p.set("view", "list");
    return `/leads${p.size ? `?${p}` : ""}`;
  };
  const rows = [...LF].sort((a, b) => {
    const ai = ACTIVE(a.stage) ? 0 : 1;
    const bi = ACTIVE(b.stage) ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return (fu(a) ?? "9") < (fu(b) ?? "9") ? -1 : 1;
  });

  return (
    <div className="flex flex-col gap-[26px] pt-4">
      <ListHeader
        kicker="Enquiries, trials and walk-ins"
        title="Leads & trials"
        actions={
          <>
            <LinkButton href="/reports/leads/csv" prefetch={false}>
              <DownloadSimpleIcon weight="duotone" />
              CSV
            </LinkButton>
            <LinkButton href="/leads/new" variant="primary">
              <PlusIcon size={17} weight="duotone" />
              Add lead
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] gap-x-9 gap-y-6">
        {kpis.map(([k, v, sub, alert]) => (
          <div key={k}>
            <div className="text-[11px] tracking-[0.08em] text-muted uppercase">{k}</div>
            <div className={cx("mt-1 text-[28px] leading-[1.15] font-semibold", alert && "text-alert-700")}>{v}</div>
            <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>
          </div>
        ))}
      </div>

      {due.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="m-0 flex items-center gap-2 text-lg">
              <BellRingingIcon weight="duotone" className="text-alert-700" />
              Follow up today
            </h3>
            {due.length > 6 && <span className="text-[13px] text-muted">+{due.length - 6} more</span>}
          </div>
          <div className="flex gap-3.5 overflow-x-auto pb-1.5">
            {due.slice(0, 6).map((l) => {
              const i = info(l);
              return (
                <div key={l.id} className="flex min-w-[260px] flex-[0_0_260px] flex-col gap-2.5 rounded-[14px] border border-line bg-bg px-4 py-3.5 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <Initials name={l.name} size="size-9 text-[13px]" />
                    <Link href={`/leads/${l.id}`} className="min-w-0 flex-1">
                      <div className="truncate text-[15px] leading-[1.2] font-semibold">{l.name}</div>
                      <div className="mt-0.5 text-xs text-muted">{l.phone}</div>
                    </Link>
                    <span className="text-[11px] whitespace-nowrap text-faint" title="Time in this stage">
                      {i.age}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip>{l.source}</Chip>
                    <Chip gold>Wants {l.interest}</Chip>
                  </div>
                  {l.notes && <div className="line-clamp-2 text-[13px] leading-[1.45] text-neutral-800">{l.notes}</div>}
                  <div className="flex flex-col gap-1">
                    {i.trial && (
                      <div className="inline-flex items-center gap-1.5 text-xs text-accent-strong">
                        <CalendarCheckIcon weight="duotone" />
                        {i.trial}
                      </div>
                    )}
                    <FollowUp i={i} />
                  </div>
                  <div className="flex items-center gap-1.5 border-t border-line pt-1.5">
                    <LeadActions id={l.id} stage={l.stage as LeadStage} phone={l.phone} message={i.message} card />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <AutoFilter className="flex flex-wrap items-center gap-2.5">
          {view === "list" && <input type="hidden" name="view" value="list" />}
          <input type="text" name="q" defaultValue={s("q")} placeholder="Search name, phone or notes" aria-label="Search leads" className={cx(SEARCH, "max-w-[300px]")} />
          <Select name="source" defaultValue={src} aria-label="Source" className="w-auto!">
            <option value="">All sources</option>
            {SOURCES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </AutoFilter>
        <Segmented
          current={view}
          options={[
            { key: "board", label: "By stage", href: link({ view: "board" }) },
            { key: "list", label: "All leads", href: link({ view: "list" }) },
          ]}
        />
      </div>

      {view === "board" ? (
        <ScrollRegion label="Leads list" className="rounded-[14px] border border-line bg-surface">
          <table className="w-full min-w-[1120px] border-collapse text-sm">
            <thead>
              <tr>
                {[
                  ["Lead", "w-[21%]"],
                  ["Source · Interest", "w-[13%]"],
                  ["Notes", "min-w-[240px]"],
                  ["Next step", "w-[15%]"],
                  ["In stage", "w-[70px] text-right"],
                  ["Actions", "w-[200px] text-right"],
                ].map(([h, w]) => (
                  <th key={h} className={cx("border-b border-line px-3 py-2.5 text-left text-[11px] font-semibold tracking-[0.1em] whitespace-nowrap text-muted uppercase", w)}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            {LEAD_STAGES.map((st) => {
              const items = LF.filter((l) => l.stage === st);
              return (
                <tbody key={st}>
                  <tr>
                    <td
                      colSpan={6}
                      className={cx(
                        "border-y border-line px-3 py-2.5",
                        st === "Won" ? "bg-[color-mix(in_srgb,#2e9e63_14%,var(--surface))]" : st === "Lost" ? "bg-alert-soft" : "bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface))]",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="size-[9px] rounded-full" style={{ background: STAGE_COLOR[st] }} />
                        <span className="text-[13px] font-bold tracking-[0.06em] uppercase">{st}</span>
                        <span className="rounded-full bg-bg px-2 py-px text-xs font-semibold text-neutral-800">{items.length}</span>
                      </div>
                    </td>
                  </tr>
                  {items.map((l) => {
                    const i = info(l);
                    const cell = "border-b border-fg/8 p-3 align-middle";
                    return (
                      <tr key={l.id}>
                        <td className={cell}>
                          <div className="flex items-center gap-2.5">
                            <Initials name={l.name} size="size-[34px] text-[12.5px]" />
                            <Link href={`/leads/${l.id}`} className="min-w-0 hover:text-accent">
                              <div className="truncate leading-[1.2] font-semibold">{l.name}</div>
                              <div className="mt-0.5 text-xs text-muted">{l.phone}</div>
                            </Link>
                          </div>
                        </td>
                        <td className={cell}>
                          <div className="text-[13px] whitespace-nowrap">{l.source}</div>
                          <div className="text-xs whitespace-nowrap text-accent-strong">Wants {l.interest}</div>
                        </td>
                        <td className={cx(cell, "max-w-[320px] text-[13px] leading-[1.45] text-neutral-800")}>
                          <div className="line-clamp-3">{l.notes}</div>
                          {i.trial && (
                            <div className="mt-0.5 inline-flex items-center gap-1 text-xs whitespace-nowrap text-accent-strong">
                              <CalendarCheckIcon weight="duotone" />
                              {i.trial}
                            </div>
                          )}
                        </td>
                        <td className={cell}>
                          <FollowUp i={i} />
                        </td>
                        <td className={cx(cell, "text-right text-[13px] whitespace-nowrap text-muted")}>{i.age}</td>
                        <td className={cx(cell, "text-right whitespace-nowrap")}>
                          <LeadActions id={l.id} stage={l.stage as LeadStage} phone={l.phone} message={i.message} />
                        </td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-3 text-[12.5px] text-faint">
                        No leads in this stage
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </ScrollRegion>
      ) : (
        <>
          <ScrollRegion label="Lead history">
            <table className={TABLE}>
              <thead>
                <tr>
                  {["Lead", "Source", "Interested in", "Stage", "Next step", "In stage", ""].map((h, k) => (
                    <th key={k} className={TH}>
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const i = info(l);
                  return (
                    <tr key={l.id} className="hover:bg-fg/4">
                      <td className={cx(TD, "whitespace-nowrap")}>
                        <Link href={`/leads/${l.id}`} className="hover:text-accent">
                          <div className="font-semibold">{l.name}</div>
                          <div className="text-xs text-muted">{l.phone}</div>
                        </Link>
                      </td>
                      <td className={cx(TD, "whitespace-nowrap")}>{l.source}</td>
                      <td className={cx(TD, "whitespace-nowrap")}>{l.interest}</td>
                      <td className={cx(TD, "whitespace-nowrap")}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-2 rounded-full" style={{ background: STAGE_COLOR[l.stage] }} />
                          {l.stage}
                        </span>
                      </td>
                      <td className={cx(TD, "whitespace-nowrap")}>
                        <FollowUp i={i} />
                      </td>
                      <td className={cx(TD, "whitespace-nowrap text-muted")}>{i.age}</td>
                      <td className={cx(TD, "text-right whitespace-nowrap")}>
                        <LeadActions id={l.id} stage={l.stage as LeadStage} phone={l.phone} message={i.message} showLose={false} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
          {rows.length === 0 && <div className="text-sm text-muted">No leads match.</div>}
        </>
      )}

      {bySrc.size > 0 && (
        <section className="max-w-[520px]">
          <h3 className="mb-3 text-lg">Where leads come from</h3>
          <div className="flex flex-col gap-2">
            {[...bySrc.entries()]
              .sort((a, b) => b[1].n - a[1].n)
              .map(([k, x]) => (
                <div key={k} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-[13px]">
                  <span>{k}</span>
                  <div className="h-2 rounded bg-neutral-200">
                    <div className="h-2 rounded bg-accent" style={{ width: `${Math.round((x.n / maxSrc) * 100)}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-muted">
                    <strong className="text-fg">{x.n}</strong> · {Math.round((x.w / x.n) * 100)}% joined
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

const Initials = ({ name, size }: { name: string; size: string }) => (
  <span className={cx("grid flex-none place-items-center rounded-full bg-accent-soft font-bold text-accent-strong", size)}>{initials(name)}</span>
);

const Chip = ({ children, gold }: { children: ReactNode; gold?: boolean }) => (
  <span className={cx("rounded-full px-2 py-[3px] text-[11.5px]", gold ? "bg-accent-soft text-accent-strong" : "bg-neutral-200 text-neutral-800")}>{children}</span>
);

function FollowUp({ i }: { i: { text: string; tone: string; icon: typeof ClockIcon } }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 self-start rounded-full px-[9px] py-1 text-xs font-semibold whitespace-nowrap",
        i.tone === "due" ? "bg-alert-soft text-alert-strong" : i.tone === "won" ? "bg-[color-mix(in_srgb,#2e9e63_20%,var(--bg))] text-[color-mix(in_srgb,#2e9e63_70%,var(--text))]" : "bg-neutral-200 text-neutral-800",
      )}
    >
      <i.icon weight="duotone" />
      {i.text}
    </span>
  );
}
