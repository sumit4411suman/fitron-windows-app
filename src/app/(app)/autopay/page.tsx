import Link from "next/link";
import { ArrowsClockwiseIcon, PlayIcon, PlugsIcon, PlusIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { autopayStats, getAutopaySettings, listMandates } from "@/lib/services/autopay";
import { memberOptions } from "@/lib/services/members";
import { getTax } from "@/lib/services/tax";
import { fromIso, todayIso, toIso } from "@/lib/services/time";
import { razorpayReady } from "@/lib/integrations/razorpay";
import { addDays } from "@/lib/domain/dates";
import { invoiceTotals } from "@/lib/domain/billing";
import { Dialog } from "@/components/dialog";
import { LinkButton, ListHeader, Notice, TABLE, TD, TH, cx, ScrollRegion } from "@/components/ui";
import { fmtDate, fmtStamp, fmtTime, formatRupees, initials } from "@/lib/format";
import { MandateForm } from "./autopay-forms";
import { retryAction, rowAction, runDueAction, syncAction } from "./actions";

export const metadata = { title: "UPI autopay · Fitron" };

const BAD = ["Failed", "Halted"];
const FILTERS = [
  ["All", "All"],
  ["Active", "Active"],
  ["Attention", "Needs attention"],
  ["Paused", "Paused"],
  ["Cancelled", "Cancelled"],
] as const;
/** Status chips as the prototype colours them: gold for active, pink for failures, grey otherwise. */
const STATUS_CLS: Record<string, string> = {
  Active: "bg-accent-soft text-accent-strong",
  Failed: "bg-alert-soft text-alert-strong",
  Halted: "bg-alert-soft text-alert-strong",
  Cancelled: "text-muted",
};
const small = "inline-flex items-center rounded-md px-2.5 py-[5px] text-[12.5px] font-semibold whitespace-nowrap";
const cycle = (months: number) => (months === 1 ? "Monthly" : months === 3 ? "Quarterly" : months === 6 ? "Half-yearly" : months === 12 ? "Yearly" : `Every ${months} months`);

export default async function AutopayPage({ searchParams }: PageProps<"/autopay">) {
  const u = await requirePermission("autopay.manage");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const f = FILTERS.some(([k]) => k === str("f")) ? str("f")! : "All";
  const today = todayIso();
  const [settings, mandates] = await Promise.all([getAutopaySettings(u.orgId), listMandates(u)]);
  const live = settings.mode === "live";
  const stats = await autopayStats(u, mandates, today);
  const notices = await db.whatsAppMessage.findMany({ where: { memberId: { in: mandates.map((m) => m.memberId) }, templateKey: "autopay", sentAt: { gte: fromIso(addDays(today, -1)) } }, select: { memberId: true } });
  const noticed = new Set(notices.map((n) => n.memberId));
  const lastRun = await db.jobRun.findFirst({ where: { orgId: u.orgId, name: "autopay", finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, select: { day: true, finishedAt: true } });

  const lastSync = settings.lastSyncAt ? new Date(settings.lastSyncAt) : null;
  const next = (m: (typeof mandates)[number]) => (m.nextDebitOn ? toIso(m.nextDebitOn) : null);
  const active = mandates.filter((m) => m.status === "Active");
  const in7 = active.filter((m) => (next(m) ?? "9") <= addDays(today, 7));
  const attention = mandates.filter((m) => BAD.includes(m.status));
  const kpis: [string, string, string, boolean?][] = [
    ["Active mandates", String(active.length), `${mandates.filter((m) => m.status === "Pending").length} awaiting approval`],
    ["Recurring value", formatRupees(active.reduce((a, m) => a + m.amount, 0)), "per cycle across active mandates"],
    ["Debits in 7 days", String(in7.length), `${formatRupees(in7.reduce((a, m) => a + m.amount, 0))} expected`],
    ["Collected · 30 days", formatRupees(stats.collected), `${stats.collectedCount} autopay debits`],
    ["Need attention", String(attention.length), attention.length ? "failed or halted" : "all clear", attention.length > 0],
  ];
  const rows = mandates
    .filter((m) => f === "All" || (f === "Attention" ? [...BAD, "Pending"].includes(m.status) : m.status === f))
    .sort((a, b) => Number(!BAD.includes(a.status)) - Number(!BAD.includes(b.status)) || (next(a) ?? "9").localeCompare(next(b) ?? "9"));
  const upcoming = active
    .filter((m) => (next(m) ?? "") >= today)
    .sort((a, b) => next(a)!.localeCompare(next(b)!))
    .slice(0, 6);
  const how = live
    ? [
        "Member approves the mandate once in any UPI app from the WhatsApp link.",
        "Razorpay sends the NPCI pre-debit notice 24 hours before and charges on the renewal date.",
        "Fitron records the renewal, invoice and payment from the Razorpay webhook and sends the invoice on WhatsApp.",
        "Failures are retried by Razorpay; halted mandates show here for manual collection.",
      ]
    : [
        "Member approves the mandate once in their UPI app (use Approve now in demo mode).",
        "A pre-debit notice goes out on WhatsApp 24 hours before each debit.",
        "Debits run automatically at 6:30 am on the renewal date and create the renewal, invoice and payment.",
        `Failed debits retry ${settings.retries} times, ${settings.retryGap} days apart, then halt for manual collection.`,
      ];
  const missing = live ? razorpayReady() : null;
  const fq = f === "All" ? "" : f;
  const href = (k: string) => (k === "All" ? "/autopay" : `/autopay?f=${k}`);

  const newOpen = str("do") === "new";
  const [members, plans, tax] = newOpen
    ? await Promise.all([memberOptions(u), db.membershipPlan.findMany({ where: { orgId: u.orgId, status: "ACTIVE" }, orderBy: { price: "asc" } }), getTax(u.orgId)])
    : [[], [], null];

  return (
    <div className="flex flex-col gap-[26px]">
      <ListHeader
        kicker={live ? "Live · Razorpay UPI Autopay" : "Demo mode · debits are simulated inside Fitron"}
        title="UPI autopay"
        actions={
          <>
            {!live && (
              <form action={runDueAction}>
                <button className="inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">
                  <PlayIcon size={16} weight="duotone" />
                  Run today’s debits
                </button>
              </form>
            )}
            <form action={syncAction.bind(null, fq)}>
              <button className="inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">
                <ArrowsClockwiseIcon size={16} weight="duotone" />
                Sync with Razorpay
              </button>
            </form>
            <LinkButton href={`${href(f)}${fq ? "&" : "?"}do=new`} variant="primary" scroll={false}>
              <PlusIcon size={16} weight="duotone" />
              New mandate
            </LinkButton>
          </>
        }
      />

      <div className="grid gap-x-8 gap-y-[22px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr))]">
        {kpis.map(([k, v, sub, bad]) => (
          <div key={k}>
            <div className="text-[11px] tracking-[0.08em] text-muted uppercase">{k}</div>
            <div className={cx("mt-1 text-[28px] leading-[1.15] font-semibold", bad && "text-alert-700")}>{v}</div>
            <div className="mt-0.5 text-[12.5px] text-muted">{sub}</div>
          </div>
        ))}
      </div>

      {missing && (
        <Notice tone="alert">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <PlugsIcon size={18} weight="duotone" />
              Razorpay keys are not set on the server, so new mandates and debit results cannot be synced with Razorpay.
            </span>
            <LinkButton href="/settings?tab=int">Settings</LinkButton>
          </span>
        </Notice>
      )}
      {str("msg") && <Notice tone="ok">{str("msg")}</Notice>}

      <div className="grid items-start gap-x-12 gap-y-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
        <div>
          <h3 className="mb-2.5 text-lg">How it works</h3>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm leading-relaxed text-fg/85">
            {how.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
          {live && (
            <div className="mt-2.5 text-[12.5px] text-muted">
              Last sync with Razorpay: {lastSync ? `${toIso(new Date(lastSync.getTime() + 330 * 60_000)) === today ? "Today" : fmtStamp(lastSync)}, ${fmtTime(lastSync)} · ${settings.lastSync?.applied ? `${settings.lastSync.applied} update${settings.lastSync.applied === 1 ? "" : "s"}` : "up to date"}` : "never"}
            </div>
          )}
          {!live && (
            <div className="mt-2.5 text-[12.5px] text-muted">
              Last automatic run: {lastRun ? `${lastRun.day === today ? "Today" : fmtDate(lastRun.day)}, ${fmtTime(lastRun.finishedAt)}` : "not yet today"}
            </div>
          )}
        </div>
        {upcoming.length > 0 && (
          <div>
            <h3 className="mb-2.5 text-lg">Upcoming debits</h3>
            <div className="flex flex-col">
              {upcoming.map((m) => {
                const d = next(m)!;
                return (
                  <div key={m.id} className="flex items-baseline justify-between gap-3 border-b border-line-soft py-2 text-sm">
                    <span>
                      <span className="font-semibold">{m.member.name}</span>
                      <span className="ml-2 text-xs text-muted">{noticed.has(m.memberId) ? "notice sent" : d === addDays(today, 1) ? "notice due today" : ""}</span>
                    </span>
                    <span className="whitespace-nowrap">
                      <span className="mr-2.5 text-muted">{d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : fmtDate(d)}</span>
                      <strong>{formatRupees(m.amount)}</strong>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="inline-flex flex-wrap self-start overflow-hidden rounded-md border border-line">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={href(k)} className={cx("px-3 py-[7px] text-[13px]", k === f ? "bg-accent text-accent-ink" : "hover:bg-fg/7")}>
            {label}
          </Link>
        ))}
      </div>

      <ScrollRegion label="Autopay table">
        <table className={TABLE}>
          <thead>
            <tr>
              {["Member", "Mandate", "Plan · cycle", "Amount", "Next debit", "Debits", "Last result", "Status", ""].map((h, i) => (
                <th key={i} className={cx(TH, h === "Amount" && "text-right")}>
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const bad = BAD.includes(m.status);
              const d = next(m);
              return (
                <tr key={m.id} className={cx("hover:bg-fg/4", bad && "bg-alert-soft/60")}>
                  <td className={cx(TD, "whitespace-nowrap")}>
                    <Link href={`/members/${m.member.id}`} className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-strong">{initials(m.member.name)}</span>
                      <span>
                        <span className="block font-semibold">{m.member.name}</span>
                        <span className="block text-xs text-muted">{m.member.code}</span>
                      </span>
                    </Link>
                  </td>
                  <td className={cx(TD, "text-[13px]")}>
                    <Link href={`/autopay/${m.id}`} className="hover:text-accent">
                      {m.vpa ?? m.code}
                    </Link>
                    <div className="text-[11.5px] whitespace-nowrap text-muted">
                      {m.mode === "live" ? "Razorpay" : "Demo"} · {m.subscriptionId ?? (m.vpa ? m.code : "UPI ID at approval")}
                    </div>
                  </td>
                  <td className={cx(TD, "text-[13px] whitespace-nowrap")}>
                    {m.planName} · {cycle(m.months)}
                  </td>
                  <td className={cx(TD, "text-right font-semibold whitespace-nowrap")}>{formatRupees(m.amount)}</td>
                  <td className={cx(TD, "whitespace-nowrap", m.status === "Active" && d && d <= addDays(today, 2) && "font-semibold")}>{m.status === "Active" && d ? fmtDate(d) : m.status === "Failed" && m.nextRetryOn ? `Retry ${fmtDate(toIso(m.nextRetryOn))}` : "—"}</td>
                  <td className={cx(TD, "text-center")}>{stats.debits.get(m.id) ?? 0}</td>
                  <td className={cx(TD, "max-w-[260px] text-[12.5px] text-fg/85")}>{m.lastResult ?? ""}</td>
                  <td className={TD}>
                    <span className={cx("inline-flex rounded-sm px-2.5 py-[3px] text-[11px] whitespace-nowrap", STATUS_CLS[m.status] ?? "bg-neutral-200 text-neutral-800")}>
                      {m.status === "Pending" ? "Pending approval" : m.status}
                    </span>
                  </td>
                  <td className={cx(TD, "text-right whitespace-nowrap")}>
                    <span className="inline-flex items-center justify-end gap-1">
                      {m.status === "Pending" && m.mode === "demo" && (
                        <form action={rowAction.bind(null, m.id, "approve-demo", fq)}>
                          <button className={cx(small, "bg-accent text-accent-ink hover:bg-accent-hover")}>Approve now</button>
                        </form>
                      )}
                      {bad && (
                        <form action={retryAction.bind(null, m.id, fq)}>
                          <button className={cx(small, "border border-line hover:bg-fg/7")}>Retry now</button>
                        </form>
                      )}
                      {bad && (
                        <Link href={`/members/${m.member.id}/sell`} className={cx(small, "border border-line hover:bg-fg/7")}>
                          Collect manually
                        </Link>
                      )}
                      {(m.status === "Active" || m.status === "Paused") && (
                        <form action={rowAction.bind(null, m.id, m.status === "Paused" ? "resume" : "pause", fq)}>
                          <button className={cx(small, "text-accent hover:bg-accent/10")}>{m.status === "Paused" ? "Resume" : "Pause"}</button>
                        </form>
                      )}
                      {m.status !== "Cancelled" && (
                        <form action={rowAction.bind(null, m.id, "cancel", fq)}>
                          <button aria-label="Cancel mandate" title="Cancel mandate" className="grid h-[30px] w-[30px] place-items-center rounded-md text-alert-700 hover:bg-alert-soft">
                            <XIcon size={16} weight="duotone" />
                          </button>
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
      {!rows.length && <div className="text-sm text-muted">No mandates match this filter.</div>}

      {newOpen && tax && (
        <Dialog kicker="UPI autopay" title="New mandate" close={href(f)} form note="The member gets the approval link on WhatsApp. Each cycle debits the plan price with GST and renews the membership.">
          <MandateForm
            members={members}
            plans={plans.map((p) => ({ id: p.id, label: `${p.name} · ${formatRupees(invoiceTotals([{ qty: 1, rate: p.price, discount: p.discount, taxRate: tax.enabled && p.gstApplicable ? tax.rate : 0 }]).total)} ${cycle(p.months).toLowerCase()}` }))}
          />
        </Dialog>
      )}
    </div>
  );
}
