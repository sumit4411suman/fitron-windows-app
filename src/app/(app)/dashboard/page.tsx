import { getGymProfile } from "@/lib/services/settings";
import { getOnboarding } from "@/lib/services/onboarding";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canOpen } from "@/lib/nav";
import { FEATURES, planFor, type Feature } from "@/lib/domain/features";
import type { ReactNode } from "react";
import {
  ArrowsClockwiseIcon,
  BarbellIcon,
  CalendarCheckIcon,
  ChartLineUpIcon,
  ClockCountdownIcon,
  DoorOpenIcon,
  HandCoinsIcon,
  UsersIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { requireUser } from "@/lib/auth/current";
import { dashboardData, type Dashboard } from "@/lib/services/dashboard";
import { getAiSettings } from "@/lib/services/ai-settings";
import { dailyBrief, type Alert } from "@/lib/services/insights";
import { PERIODS, isPeriod, monthLabel, type PeriodKey } from "@/lib/domain/periods";
import { Notice, cx, ScrollRegion } from "@/components/ui";
import { fmtMonthShort, fmtShort, formatRupees, initials } from "@/lib/format";
import { BranchRow } from "./branch-row";
import { QuickActions, type QuickKey } from "./quick-actions";

export const metadata = { title: "Dashboard · Fitron" };

const inr = formatRupees;
const num = (n: number) => n.toLocaleString("en-IN");
const pct = (v: number, max: number) => `${max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0}%`;

const ROLE_TITLE: Record<string, string> = {
  "Super Admin": "Owner view",
  Admin: "Manager view",
  Accountant: "Accounts view",
  Receptionist: "Front desk view",
  Trainer: "Trainer view",
};
const METHOD_COLORS: Record<string, string> = {
  UPI: "var(--accent)",
  Cash: "#cfc6b4",
  Card: "#e9cc82",
  "Bank Transfer": "#6b6355",
  Other: "#4a4338",
};

type Hero = { label: string; value: string; sub: string; icon: Icon; href: string; tone?: "alert" | "accent"; delta?: { text: string; good: boolean } | null };
type Kpi = { label: string; value: string; sub: string; href?: string; tone?: "alert" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const u = await requireUser();
  // A gym that signed up on fitron.in answers the setup questions before the console (src/app/onboarding); "I'll finish this later" skips them.
  const setup = u.can("settings.manage") ? await getOnboarding(u.orgId) : null;
  if (setup?.status === "PENDING") redirect("/onboarding");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const role = u.role;
  const showPeriods = role !== "Receptionist" && role !== "Trainer";
  const period: PeriodKey = showPeriods && isPeriod(s("p")) ? (s("p") as PeriodKey) : "month";
  const d = await dashboardData(u, period, { from: s("from"), to: s("to") });
  // Fitron AI on the dashboard: the org-wide switches from Settings › Integrations & AI, on top of role and plan.
  const ai = u.can("ai.use") ? await getAiSettings(u.orgId) : null;
  const aiOn = !!ai?.enabled;
  const gymName = sp.cleared ? (await getGymProfile(u.orgId)).name : "";
  const brief: Alert[] | null = aiOn && ai!.dailyBrief ? await dailyBrief(u, d.today) : null;
  const winback = aiOn && ai!.autoWinback && u.can("whatsapp.send");

  const hour = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const greet = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const todayLong = new Date(`${d.today}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(/ (\d{4})$/, ", $1");
  const branchLabel = u.branch === "ALL" ? "All branches (consolidated)" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");
  const pLabel = d.range.label;
  const profile = (id: string) => (u.can("members.view") ? `/members/${id}` : undefined);

  const quick: QuickKey[] = [
    u.can("members.create") && "member",
    u.can("payments.collect") && "collect",
    u.can("invoices.create") && "invoice",
    u.can("expenses.manage") && "expense",
    u.can("memberships.renew") && "renew",
    u.can("whatsapp.send") && "whatsapp",
  ].filter(Boolean) as QuickKey[];

  const { hero, kpis, cfg } = cards(d, role, pLabel, period);

  return (
    <div className="flex flex-col gap-7">
      {sp.welcome && <Notice tone="ok">Your gym is set up. Add your first member to get going.</Notice>}
      {setup?.status === "SKIPPED" && (
        <Notice tone="accent">
          Your gym setup isn&apos;t finished: membership plans, invoice numbering and reminders are still to do.{" "}
          <Link href="/onboarding" className="font-semibold underline">
            Finish setup
          </Link>
        </Notice>
      )}
      {sp.denied && <Notice tone="alert">Your role doesn&apos;t have access to that page.</Notice>}
      {sp.cleared && <Notice tone="ok">Demo data cleared. Fitron is live for {gymName}.</Notice>}
      {sp.ai === "off" && <Notice>Fitron AI is switched off. A Super Admin can turn it on in Settings › Integrations &amp; AI.</Notice>}
      {typeof sp.locked === "string" && sp.locked in FEATURES && (
        <Notice tone="accent">
          {FEATURES[sp.locked as Feature].label} is on the {planFor(sp.locked as Feature).name} plan. Ask a Super Admin to upgrade in Settings › Plan &amp; billing.
        </Notice>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4 pt-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs tracking-[0.08em] text-muted uppercase">
            <span className="size-[7px] rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />
            <span>
              {todayLong} · {branchLabel}
            </span>
            {ROLE_TITLE[role] && <span className="rounded-[10px] border border-accent-300 px-2 py-0.5 text-accent">{ROLE_TITLE[role]}</span>}
          </div>
          <h1 className="mt-2 text-[clamp(30px,4vw,44px)] leading-[1.05] tracking-[-0.01em]">
            Good {greet}, <em className="text-accent">{u.name.split(" ")[0]}.</em>
          </h1>
        </div>
        {showPeriods && <PeriodPicker period={period} from={d.range.from} to={d.range.to} />}
      </div>

      <QuickActions keys={quick} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3.5">
        {hero.map((k) => (
          <Tile
            key={k.label}
            href={canOpen(u, k.href) ? k.href : undefined}
            className="relative flex flex-col gap-3 overflow-hidden rounded-lg border border-t-2 border-line border-t-accent bg-[linear-gradient(180deg,var(--accent-soft),var(--surface)_60%)] px-[22px] py-5 shadow-sm transition hover:-translate-y-0.5 hover:border-accent-300 hover:shadow-md"
          >
            <span className="flex w-full items-center justify-between">
              <span className="text-xs tracking-[0.04em] text-muted uppercase">{k.label}</span>
              <span className="grid size-9 place-items-center rounded-md bg-accent-200 text-accent">
                <k.icon size={20} weight="duotone" />
              </span>
            </span>
            <span className={cx("text-[36px] leading-none font-semibold tracking-[-0.01em] tabular-nums", k.tone === "alert" && "text-alert", k.tone === "accent" && "text-accent-hover")}>{k.value}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
              {k.delta && <span className={cx("rounded-full px-[7px] py-px", k.delta.good ? "bg-accent-soft text-accent-strong" : "bg-alert-soft text-alert-strong")}>{k.delta.text}</span>}
              <span>{k.sub}</span>
            </span>
          </Tile>
        ))}
      </div>

      {d.branches && u.has("analytics") && <BranchComparison rows={d.branches} />}
      {d.branches && !u.has("analytics") && (
        <Notice tone="accent">
          Branch comparison (consolidated figures, branch by branch) is on the Enterprise plan.{" "}
          {u.can("settings.manage") ? (
            <Link href="/settings/billing?upgrade=analytics" className="font-semibold underline">
              See plans
            </Link>
          ) : (
            "Ask a Super Admin to upgrade."
          )}
        </Notice>
      )}

      <div className="rounded-lg border border-line bg-surface px-[22px] py-1.5 shadow-sm">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-x-6">
          {kpis.map((k) => {
            const body = (
              <>
                <span className="text-[11px] tracking-[0.06em] text-muted uppercase">{k.label}</span>
                <span className={cx("text-2xl leading-[1.1] font-semibold tabular-nums", k.tone === "alert" && "text-alert")}>{k.value}</span>
                <span className="text-[11px] text-faint">{k.sub}</span>
              </>
            );
            const cls = "flex flex-col gap-[3px] border-b border-line-soft py-3.5 text-left";
            return k.href && canOpen(u, k.href) ? (
              <Link key={k.label} href={k.href} className={cls}>
                {body}
              </Link>
            ) : (
              <div key={k.label} className={cls}>
                {body}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {brief && (
          <Section
            title={
              <>
                <Image src="/fitron-mark.png" alt="" width={22} height={22} className="rounded-full" />
                Today&apos;s brief
              </>
            }
            titleSize="text-[17px]"
            sub="Fitron AI · what needs attention today"
            action={<GhostLink href="/ai">Open Fitron AI</GhostLink>}
          >
            {brief.map((a, i) => {
              const Row = a.href ? Link : "div";
              return (
                <Row key={i} href={a.href!} className="flex w-full flex-col gap-0.5 border-b border-line-soft py-[9px] text-left">
                  <span className={cx("text-sm font-semibold", a.tone === "alert" && "text-alert", a.tone === "accent" && "text-accent-strong")}>{a.title}</span>
                  <span className="text-xs text-muted">{a.detail}</span>
                </Row>
              );
            })}
            {brief.length === 0 && <p className="m-0 text-sm text-muted">Nothing needs attention right now.</p>}
          </Section>
        )}
        {d.fin && cfg.charts && (
          <>
            <Section title="Revenue and expenses" sub="Last 12 months" legend={[["var(--accent)", "Revenue"], ["#4a4338", "Expenses"]]}>
              <RevenueBars series={d.series} />
            </Section>
            <Section title="Profit and loss" sub={`Net by month · ${inr(d.series.reduce((x, m) => x + m.net, 0))} over 12 months`}>
              <ProfitBars series={d.series} />
            </Section>
          </>
        )}
        <Section title="Member growth" sub={`Active members at month end · now ${d.hero.active}`}>
          <Growth series={d.series} />
        </Section>
        {cfg.charts && (
          <Section title="New members and renewals" sub="Memberships started per month" legend={[["var(--text)", "New"], ["#8a6612", "Renewals"]]}>
            <NewRenewBars series={d.series} />
          </Section>
        )}
        {cfg.plans && (
          <Section title="Plan distribution" sub={`Active members by plan · revenue for ${pLabel}`}>
            <div className="flex flex-col gap-3">
              {d.plans.map((p) => (
                <div key={p.name} className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
                  <span className="truncate">{p.name}</span>
                  <span className="h-2 overflow-hidden rounded bg-[#352f26] light:bg-[#d6cebd]">
                    <span className="block h-full bg-accent" style={{ width: pct(p.members, d.plans[0]!.members) }} />
                  </span>
                  <span className="whitespace-nowrap text-muted">
                    {p.members} members · {inr(p.revenue)}
                  </span>
                </div>
              ))}
              {d.plans.length === 0 && <p className="m-0 text-sm text-muted">No active members on a plan yet.</p>}
            </div>
          </Section>
        )}
        {cfg.methods && (
          <Section title="Payment methods" sub={`Collections for ${pLabel}`}>
            <Methods methods={d.methods} />
          </Section>
        )}
        {cfg.outstanding && (
          <Section title="Outstanding payments" sub="Largest balances first" action={<GhostLink href="/receivables">All receivables</GhostLink>}>
            {d.outstanding.map((o) => (
              <PersonRow key={o.number} href={profile(o.memberId) ?? "/receivables"} name={o.name} sub={`${o.number}${o.overdueDays ? ` · ${o.overdueDays} days overdue` : ` · due ${fmtShort(o.due)}`}`}>
                <span className="font-semibold text-alert">{inr(o.balance)}</span>
              </PersonRow>
            ))}
            {d.outstanding.length === 0 && <p className="m-0 text-sm text-muted">Nothing outstanding.</p>}
          </Section>
        )}
        <Section title="Expiring this week" sub="Renewal reminders go out automatically" action={u.can("memberships.renew") ? <GhostLink href="/renewals">Renewal list</GhostLink> : undefined}>
          {d.expiring.map((m) => (
            <PersonRow key={m.id} href={profile(m.id)} name={m.name} sub={`${m.code} · ${m.planName ?? "—"} · ${m.phone}`}>
              <span className="rounded-sm bg-accent-soft px-2.5 py-[3px] text-[11px] whitespace-nowrap text-accent-strong">
                {m.daysLeft === 0 ? "Today" : m.daysLeft === 1 ? "Tomorrow" : `in ${m.daysLeft} days`}
              </span>
            </PersonRow>
          ))}
          {d.expiring.length === 0 && <p className="m-0 text-sm text-muted">No memberships expire in the next 7 days.</p>}
        </Section>
        {cfg.risk && (
          <Section
            title={
              <>
                <Image src="/fitron-mark.png" alt="" width={22} height={22} className="rounded-full" />
                Members at risk
              </>
            }
            titleSize="text-[17px]"
            sub="Fitron AI · scored from visits, expiry and dues"
            action={aiOn ? <GhostLink href="/ai">{winback ? "Review win-back messages" : "Ask Fitron AI"}</GhostLink> : undefined}
          >
            {d.risk.map((o) => (
              <PersonRow key={o.id} href={profile(o.id)} name={o.name} sub={o.sub}>
                <span className={cx("rounded-sm border px-2.5 py-[3px] text-[11px] whitespace-nowrap", o.level === "High risk" ? "border-alert/50 bg-alert-soft text-alert-strong" : "border-accent/50 bg-accent-soft text-accent-strong")}>{o.level}</span>
              </PersonRow>
            ))}
            {d.risk.length === 0 && <p className="m-0 text-sm text-muted">No members at risk right now.</p>}
          </Section>
        )}
      </div>
    </div>
  );
}

/** Hero cards, KPI strip and which sections show, by role (prototype V.dash and V.roleDash). */
function cards(d: Dashboard, role: string, pLabel: string, period: PeriodKey) {
  const h = d.hero;
  const k = d.kpis;
  const cfg = { charts: true, plans: true, methods: d.seesMoney, outstanding: d.seesMoney, risk: true };
  if (d.frontDesk) {
    const f = d.frontDesk;
    return {
      cfg: { ...cfg, plans: false, methods: false },
      hero: [
        { label: "Active members", value: num(h.active), sub: `${num(h.total)} total`, icon: UsersThreeIcon, href: "/members?status=ACTIVE" },
        { label: "Check-ins today", value: num(f.checkins), sub: `${f.inside} in the gym now`, icon: DoorOpenIcon, href: "/attendance" },
        { label: "Expiring in 7 days", value: num(h.exp7), sub: "call or WhatsApp to renew", icon: ArrowsClockwiseIcon, href: "/renewals", tone: h.exp7 ? "accent" : undefined },
        { label: "Payments due", value: num(f.paymentsDue), sub: "members to collect from", icon: HandCoinsIcon, href: "/receivables?f=overdue", tone: f.paymentsDue ? "alert" : undefined },
      ] satisfies Hero[],
      kpis: [
        { label: "New members today", value: num(f.newToday), sub: "joined today", href: "/members" },
        { label: "Expired members", value: num(k.expired), sub: "not yet renewed", href: "/renewals?w=lapsed" },
        { label: "Lead follow-ups", value: num(f.followUps), sub: "due today", href: "/leads?due=1" },
        { label: "Class bookings", value: num(f.bookings), sub: "today", href: "/classes" },
        { label: "Birthdays", value: num(f.birthdays), sub: "today" },
        { label: "Frozen", value: num(f.frozen), sub: "memberships on hold" },
      ] satisfies Kpi[],
    };
  }
  if (d.trainer) {
    const t = d.trainer;
    return {
      cfg: { ...cfg, charts: false, plans: false, methods: false, outstanding: false },
      hero: [
        { label: "My members", value: num(t.mine), sub: "assigned to you", icon: UsersIcon, href: "/members" },
        { label: "Trained today", value: num(t.trainedToday), sub: "of your members checked in", icon: BarbellIcon, href: "/attendance" },
        { label: "Class bookings", value: num(t.bookings), sub: "today", icon: CalendarCheckIcon, href: "/classes" },
        { label: "Expiring soon", value: num(t.expiring), sub: "of your members, 7 days", icon: ClockCountdownIcon, href: "/members" },
      ] satisfies Hero[],
      kpis: [
        { label: "On a workout plan", value: num(t.onWorkout), sub: `of ${t.mine}`, href: "/programs" },
        { label: "On a diet plan", value: num(t.onDiet), sub: `of ${t.mine}`, href: "/programs" },
        { label: "No visit 14+ days", value: num(t.highRisk), sub: "need a check-in call" },
      ] satisfies Kpi[],
    };
  }
  const fin = d.fin;
  const hero: Hero[] = [
    { label: "Active members", value: num(h.active), sub: `${num(h.total)} total · ${num(h.expired)} expired`, icon: UsersThreeIcon, href: "/members?status=ACTIVE" },
    fin
      ? { label: "Revenue", value: inr(h.revenue), sub: period === "month" ? "vs same days last month" : pLabel, icon: ChartLineUpIcon, href: "/accounting", delta: h.revenueDelta }
      : { label: "Collections", value: inr(h.collected), sub: `${h.collectedCount} payments · ${pLabel}`, icon: HandCoinsIcon, href: "/payments", delta: h.collectedDelta },
    { label: "Outstanding", value: inr(h.outstanding), sub: `${h.openCount} invoices · ${h.overdueCount} overdue`, icon: ClockCountdownIcon, href: "/receivables", tone: h.openCount ? "alert" : undefined },
    { label: "Expiring in 7 days", value: num(h.exp7), sub: `${inr(h.exp7Value)} renewal value`, icon: ArrowsClockwiseIcon, href: "/renewals", tone: h.exp7 ? "accent" : undefined },
  ];
  const kpis: (Kpi & { finOnly?: boolean })[] = [
    { label: "New members", value: num(k.newMembers), sub: period === "month" && k.newMembersLast ? `${k.newMembersLast} by this day last month` : pLabel, href: "/members" },
    { label: "Today's collections", value: inr(k.todayCollected), sub: `${k.todayCount} payment${k.todayCount === 1 ? "" : "s"}`, href: "/payments" },
    { label: "Collections", value: inr(h.collected), sub: `${h.collectedCount} payments · ${pLabel}`, href: "/payments" },
    { label: "Expenses", value: inr(k.expenses), sub: pLabel, href: "/expenses", finOnly: true },
    { label: "Net profit", value: inr(k.net), sub: h.revenue ? `${Math.round((k.net / h.revenue) * 100)}% margin` : "", href: "/accounting", tone: k.net < 0 ? "alert" : undefined, finOnly: true },
    { label: "Monthly recurring revenue", value: inr(k.mrr), sub: "from active plans", finOnly: true },
    { label: "New memberships", value: num(k.newMemberships), sub: `${inr(k.newMembershipsValue)} · ${pLabel}` },
    { label: "Renewals", value: num(k.renewals), sub: `${inr(k.renewalsValue)} · ${pLabel}`, href: "/renewals" },
    { label: "Pending payments", value: num(k.pending), sub: "invoices with a balance", href: "/receivables" },
    { label: "Expired members", value: num(k.expired), sub: "Not yet renewed", href: "/renewals?w=lapsed" },
  ];
  return {
    cfg: role === "Accountant" ? { ...cfg, risk: false, plans: false } : cfg,
    hero,
    kpis: kpis.filter((x) => fin || !x.finOnly).filter((x) => d.seesMoney || !["Today's collections", "Collections", "Pending payments"].includes(x.label)),
  };
}

function PeriodPicker({ period, from, to }: { period: PeriodKey; from: string; to: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface p-[3px]">
        {PERIODS.map(([k, label]) => (
          <Link
            key={k}
            href={k === "month" ? "/dashboard" : `/dashboard?p=${k}${k === "custom" ? `&from=${from}&to=${to}` : ""}`}
            className={cx("rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap", period === k ? "bg-accent text-accent-ink" : "text-fg hover:bg-fg/7")}
          >
            {label}
          </Link>
        ))}
      </div>
      {period === "custom" && (
        <form className="flex items-center gap-2">
          <input type="hidden" name="p" value="custom" />
          <input type="date" name="from" defaultValue={from} aria-label="From" className="min-h-9 rounded-md border border-line bg-surface px-2.5 text-fg" />
          <input type="date" name="to" defaultValue={to} aria-label="To" className="min-h-9 rounded-md border border-line bg-surface px-2.5 text-fg" />
          <button className="min-h-9 rounded-md border border-line px-3 text-sm font-semibold hover:bg-fg/7">Show</button>
        </form>
      )}
    </div>
  );
}

function Section({ title, sub, action, legend, titleSize = "text-lg", children }: { title: ReactNode; sub?: string; action?: ReactNode; legend?: [string, string][]; titleSize?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-line bg-surface px-[22px] py-5 shadow-sm">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div>
          <h3 className={cx("m-0 flex items-center gap-2", titleSize)}>{title}</h3>
          {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
        </div>
        {legend && (
          <div className="flex gap-3.5 text-xs text-muted">
            {legend.map(([c, l]) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px]" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
        )}
        {action}
      </div>
      {children}
    </section>
  );
}

/** A link when there's somewhere this person may go, otherwise the same box without one. */
const Tile = ({ href, className, children }: { href?: string; className: string; children: ReactNode }) =>
  href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );

const GhostLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="-mt-1.5 -mr-2 inline-flex py-2.5 leading-[1.2] items-center rounded-md px-1.5 text-sm font-semibold whitespace-nowrap text-accent hover:bg-accent/10">
    {children}
  </Link>
);

function PersonRow({ href, name, sub, children }: { href?: string; name: string; sub: string; children: ReactNode }) {
  const Row = href ? Link : "div";
  return (
    <Row href={href!} className="flex w-full items-center gap-3 border-b border-line-soft py-[9px] text-left">
      <span className="grid size-8 flex-none place-items-center rounded-full bg-bg text-xs font-semibold">{initials(name)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{name}</span>
        <span className="block truncate text-xs text-muted">{sub}</span>
      </span>
      {children}
    </Row>
  );
}

type Series = Dashboard["series"];

const tip = (m: Series[number]) => `${monthLabel(m.month)}: revenue ${inr(m.revenue)}, expenses ${inr(m.expenses)}, net ${inr(m.net)}`;

function RevenueBars({ series }: { series: Series }) {
  const max = Math.max(1, ...series.map((m) => Math.max(m.revenue, m.expenses)));
  return (
    <div className="flex h-[180px] items-end gap-2">
      {series.map((m) => (
        <div key={m.month} title={tip(m)} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5">
          <div className="flex flex-1 items-end gap-0.5">
            <div className="flex-1 rounded-t-[2px] bg-accent" style={{ height: pct(m.revenue, max) }} />
            <div className="flex-1 rounded-t-[2px] bg-[#4a4338] light:bg-[#b9af9b]" style={{ height: pct(m.expenses, max) }} />
          </div>
          <div className="truncate text-center text-[10px] text-muted">{fmtMonthShort(m.month)}</div>
        </div>
      ))}
    </div>
  );
}

function ProfitBars({ series }: { series: Series }) {
  const max = Math.max(1, ...series.map((m) => Math.abs(m.net)));
  return (
    <div className="flex h-[180px] gap-2">
      {series.map((m) => (
        <div key={m.month} title={tip(m)} className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-1 items-end">
            <div className="w-full rounded-t-[2px] bg-accent" style={{ height: m.net > 0 ? pct(m.net, max) : "0%" }} />
          </div>
          <div className="h-px bg-[#4a4338] light:bg-[#b9af9b]" />
          <div className="flex h-[30%] items-start">
            <div className="w-full rounded-b-[2px] bg-[#c2437a] light:bg-[#e0608f]" style={{ height: m.net < 0 ? pct(-m.net, max) : "0%" }} />
          </div>
          <div className="truncate pt-1 text-center text-[10px] text-muted">{fmtMonthShort(m.month)}</div>
        </div>
      ))}
    </div>
  );
}

function Growth({ series }: { series: Series }) {
  const acts = series.map((m) => m.active);
  const mn = Math.min(...acts);
  const mx = Math.max(...acts);
  const pts = acts.map((v, i) => `${((i * 600) / 11).toFixed(1)},${(150 - (mx === mn ? 70 : ((v - mn) / (mx - mn)) * 130)).toFixed(1)}`).join(" ");
  return (
    <>
      <svg viewBox="0 0 600 160" preserveAspectRatio="none" className="block h-[150px] w-full overflow-visible" aria-hidden="true">
        <polyline points={`${pts} 600,160 0,160`} className="fill-[#3d321a] light:fill-[#eedcaa]" stroke="none" />
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted">
        <span>{monthLabel(series[0]!.month)}</span>
        <span>{monthLabel(series[series.length - 1]!.month)}</span>
      </div>
    </>
  );
}

function NewRenewBars({ series }: { series: Series }) {
  const max = Math.max(1, ...series.map((m) => Math.max(m.newCount, m.renewCount)));
  return (
    <div className="flex h-[150px] items-end gap-2">
      {series.map((m) => (
        <div key={m.month} title={`${monthLabel(m.month)}: ${m.newCount} new, ${m.renewCount} renewals`} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5">
          <div className="flex flex-1 items-end gap-0.5">
            <div className="flex-1 rounded-t-[2px] bg-fg" style={{ height: pct(m.newCount, max) }} />
            <div className="flex-1 rounded-t-[2px] bg-[#8a6612] light:bg-[#c9a24a]" style={{ height: pct(m.renewCount, max) }} />
          </div>
          <div className="truncate text-center text-[10px] text-muted">{fmtMonthShort(m.month)}</div>
        </div>
      ))}
    </div>
  );
}

function Methods({ methods }: { methods: Dashboard["methods"] }) {
  const total = methods.reduce((s, m) => s + m.amount, 0);
  if (!total) return <p className="m-0 text-sm text-muted">No payments in this period.</p>;
  return (
    <>
      <div className="mb-4 flex h-3 overflow-hidden rounded-md bg-[#352f26] light:bg-[#d6cebd]">
        {methods.map((m) => (
          <span key={m.method} title={m.method} className="h-full" style={{ width: pct(m.amount, total), background: METHOD_COLORS[m.method] ?? "#4a4338" }} />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3.5">
        {methods.map((m) => (
          <div key={m.method} className="flex gap-2">
            <span className="mt-[5px] size-2.5 flex-none rounded-[2px]" style={{ background: METHOD_COLORS[m.method] ?? "#4a4338" }} />
            <div>
              <div className="text-xs text-muted">
                {m.method} · {Math.round((m.amount / total) * 100)}%
              </div>
              <div className="text-[17px] font-semibold">{inr(m.amount)}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function BranchComparison({ rows }: { rows: NonNullable<Dashboard["branches"]> }) {
  const max = Math.max(1, ...rows.map((r) => r.collected));
  const total = rows.reduce((t, r) => ({ active: t.active + r.active, collected: t.collected + r.collected, expenses: t.expenses + r.expenses }), { active: 0, collected: 0, expenses: 0 });
  const th = "border-b border-line p-2.5 text-left text-[11px] font-normal tracking-[0.08em] text-fg/60 uppercase";
  const td = "border-b border-line-soft p-2.5";
  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-line bg-surface px-[22px] py-5 shadow-sm">
      <div>
        <h3 className="m-0 text-lg">Branch comparison</h3>
        <div className="text-xs text-muted">Consolidated view · click a branch to open it</div>
      </div>
      <ScrollRegion label="Dashboard table">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>Branch</th>
              <th className={cx(th, "text-right")}>Active</th>
              <th className={cx(th, "text-right")}>Checked in today</th>
              <th className={cx(th, "text-right")}>Expiring 7 d</th>
              <th className={cx(th, "min-w-[180px]")}>Collections</th>
              <th className={cx(th, "text-right")}>Expenses</th>
              <th className={cx(th, "text-right")}>Net</th>
              <th className={cx(th, "text-right")}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <BranchRow key={r.id} id={r.id} name={r.name}>
                <td className={cx(td, "font-semibold")}>{r.name}</td>
                <td className={cx(td, "text-right")}>
                  {num(r.active)}
                  <span className="text-xs text-muted"> / {num(r.total)}</span>
                </td>
                <td className={cx(td, "text-right")}>{num(r.today)}</td>
                <td className={cx(td, "text-right")}>{num(r.exp7)}</td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-[3px] bg-[#28241d] light:bg-[#e6e0d3]">
                      <div className="h-1.5 rounded-[3px] bg-accent" style={{ width: pct(r.collected, max) }} />
                    </div>
                    <span className="whitespace-nowrap">{inr(r.collected)}</span>
                  </div>
                </td>
                <td className={cx(td, "text-right")}>{inr(r.expenses)}</td>
                <td className={cx(td, "text-right", r.net < 0 && "text-alert")}>{inr(r.net)}</td>
                <td className={cx(td, "text-right")}>{inr(r.due)}</td>
              </BranchRow>
            ))}
            <tr>
              <td className={cx(td, "font-semibold")}>Total</td>
              <td className={cx(td, "text-right font-semibold")}>{num(total.active)}</td>
              <td className={td} />
              <td className={td} />
              <td className={cx(td, "font-semibold")}>{inr(total.collected)}</td>
              <td className={cx(td, "text-right font-semibold")}>{inr(total.expenses)}</td>
              <td className={cx(td, "text-right font-semibold")}>{inr(total.collected - total.expenses)}</td>
              <td className={td} />
            </tr>
          </tbody>
        </table>
      </ScrollRegion>
    </section>
  );
}
