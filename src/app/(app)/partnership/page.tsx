import Link from "next/link";
import { requireFeature, requirePermission } from "@/lib/auth/current";
import { ensureTrainerCode, partnership } from "@/lib/services/trainer-gym";
import { todayIso } from "@/lib/services/time";
import { findPlan, PARTNER_SHARE, rupeesLabel, TRIAL_DAYS } from "@/lib/domain/pricing";
import { gstInside } from "@/lib/domain/saas";
import { Badge, Card, Empty, ListHeader, Notice, Stat, TABLE, TD, TH, TR, type Tone, ScrollRegion } from "@/components/ui";
import { fmtMonthShort, fmtShort, fmtStamp, formatRupees } from "@/lib/format";
import { appUrl } from "@/lib/services/accounts";

export const metadata = { title: "Gym Partnership · Fitron" };

/** A gym's share, in whole rupees (as paise), of one month of an AI Trainer plan. */
const monthlyShare = (planKey: string) => Math.round((gstInside(findPlan(planKey)!.price.MONTHLY).base * PARTNER_SHARE) / 100) * 100;

/** How the partnership works, for gyms that have not read the terms: the steps, the split and what a gym can earn. */
function HowItWorks({ code, pct }: { code: string; pct: number }) {
  const steps = [
    ["Share your gym code", `Give members code ${code} or the link above: on WhatsApp, at the front desk, or in your gym group.`],
    ["Your member trains free", `They get the AI Trainer free for ${TRIAL_DAYS} days and are linked to your gym the moment they enter the code.`],
    ["They pick a plan", "AI Pro or AI Premium, monthly or yearly, paid straight to FITRON. You never collect any money."],
    [`You earn ${pct}%, every month`, `Not just once: ${pct}% of every payment they make while linked to your gym, before GST.`],
  ];
  const plans = ["ai-pro", "ai-premium"].map((k) => ({ key: k, name: findPlan(k)!.name, price: findPlan(k)!.price.MONTHLY, share: monthlyShare(k) }));
  const pro = plans[0].share;
  return (
    <Card title="How the partnership works">
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="flex size-8 flex-none items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-ink">{i + 1}</span>
            <div>
              <div className="font-semibold">{t}</div>
              <p className="mt-0.5 text-sm text-muted">{d}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="text-[11px] tracking-[0.08em] text-muted uppercase">Who gets what, before GST</div>
          <div className="mt-2 flex h-9 overflow-hidden rounded-md text-xs font-semibold whitespace-nowrap sm:text-sm" role="img" aria-label={`Your gym ${pct}%, FITRON ${100 - pct}%`}>
            <div className="flex items-center justify-center bg-accent text-accent-ink" style={{ width: `${pct}%` }}>
              Your gym {pct}%
            </div>
            <div className="flex flex-1 items-center justify-center bg-surface-2">FITRON {100 - pct}%</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {plans.map((p) => (
              <div key={p.key} className="min-w-0 rounded-md border border-line p-3">
                <div className="text-xs text-muted">
                  {p.name} · {rupeesLabel(p.price)}/month
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums">≈ {rupeesLabel(p.share)}</div>
                <div className="text-xs text-muted">you earn per member, per month</div>
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] tracking-[0.08em] text-muted uppercase">What you could earn on AI Pro</div>
          <table className={`${TABLE} mt-2`}>
            <thead>
              <tr>
                <th className={TH}>Members</th>
                <th className={`${TH} text-right`}>A month</th>
                <th className={`${TH} text-right`}>A year</th>
              </tr>
            </thead>
            <tbody>
              {[10, 25, 50, 100].map((n) => (
                <tr key={n} className={TR}>
                  <td className={TD}>{n}</td>
                  <td className={`${TD} text-right whitespace-nowrap tabular-nums`}>≈ {rupeesLabel(n * pro)}</td>
                  <td className={`${TD} text-right font-semibold whitespace-nowrap tabular-nums`}>≈ {rupeesLabel(n * pro * 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">Members on AI Premium earn you more. FITRON pays each month&apos;s share to your bank account in the first week of the next month. Free for your gym, with no targets or minimums.</p>
        </div>
      </div>
    </Card>
  );
}

const ACCESS: Record<string, [string, Tone]> = { ACTIVE: ["Paid", "ok"], TRIAL: ["Free trial", "accent"], LOCKED: ["No plan", "neutral"] };

/** Members of this gym who use the AI Trainer, and the gym's share of what they pay FITRON. */
export default async function PartnershipPage({ searchParams }: PageProps<"/partnership">) {
  await requirePermission("accounting.view");
  const u = await requireFeature("partnership");
  const sp = await searchParams;
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const month = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : thisMonth;
  const [code, data] = await Promise.all([ensureTrainerCode(u.orgId), partnership(u, month, today)]);
  const link = `${appUrl()}/trainer?gym=${code}`;
  const prev = (ym: string, n: number) => {
    const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  };
  const months = [0, -1, -2, -3, -4, -5].map((n) => prev(thisMonth, n));
  const pct = Math.round(PARTNER_SHARE * 100);

  return (
    <div className="flex flex-col gap-6 pt-4">
      <ListHeader kicker="FITRON AI Trainer" title="Gym Partnership" />
      <Notice tone="accent">
        Members who link their AI Trainer to your gym with code <strong className="font-mono text-base tracking-wider">{code}</strong> show their training here, next to their membership. You earn {pct}% of what they pay FITRON for the AI Trainer, before GST, while linked. Share this link with them:{" "}
        <a className="underline" href={link} target="_blank" rel="noopener">
          {link}
        </a>
      </Notice>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6">
        <Stat label="Linked members" value={data.totals.members} />
        <Stat label="Paying" value={data.totals.active} />
        <Stat label="On free trial" value={data.totals.trial} />
        <Stat label={`Paid to FITRON · ${fmtMonthShort(month)}`} value={formatRupees(data.totals.base)} />
        <Stat label={`Your ${pct}% · ${fmtMonthShort(month)}`} value={formatRupees(data.totals.share)} />
      </div>

      <HowItWorks code={code} pct={pct} />

      <div className="flex flex-wrap gap-2">
        {months.map((m) => (
          <Link key={m} href={`/partnership?month=${m}`} className={m === month ? "rounded-md bg-accent px-3 py-1.5 text-sm text-accent-ink" : "rounded-md bg-surface px-3 py-1.5 text-sm hover:bg-surface-2"}>
            {fmtMonthShort(m)} {m.slice(0, 4)}
          </Link>
        ))}
      </div>

      <Card title={`AI Trainer payments · ${fmtMonthShort(month)} ${month.slice(0, 4)}`}>
        {data.paid.length === 0 ? (
          <Empty>No AI Trainer payments from your members were confirmed this month.</Empty>
        ) : (
          <ScrollRegion label="Referred members">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Paid on</th>
                  <th className={TH}>Member</th>
                  <th className={TH}>Plan</th>
                  <th className={TH}>Ref</th>
                  <th className={`${TH} text-right`}>Before GST</th>
                  <th className={`${TH} text-right`}>Your {pct}%</th>
                </tr>
              </thead>
              <tbody>
                {data.paid.map((p) => (
                  <tr key={p.id} className={TR}>
                    <td className={TD}>{fmtStamp(p.paidAt)}</td>
                    <td className={TD}>{p.member}</td>
                    <td className={TD}>
                      {findPlan(p.plan)?.name ?? p.plan} · {p.cycle === "YEARLY" ? "yearly" : "monthly"}
                      {p.periodEnd ? <span className="text-muted"> · till {fmtShort(p.periodEnd)}</span> : null}
                    </td>
                    <td className={`${TD} font-mono text-xs`}>{p.ref}</td>
                    <td className={`${TD} text-right tabular-nums`}>{rupeesLabel(p.base)}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>{rupeesLabel(p.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        <p className="mt-3 text-xs text-muted">FITRON pays the month&apos;s share to the gym&apos;s bank account in the first week of the next month. Payments confirmed after a member leaves your gym are not counted.</p>
      </Card>

      <Card title={`Linked members · ${data.rows.length}`}>
        {data.rows.length === 0 ? (
          <Empty>No member has linked yet. Share the code above, or put it on a poster at the front desk.</Empty>
        ) : (
          <ScrollRegion label="Payouts">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Member</th>
                  <th className={TH}>Gym record</th>
                  <th className={TH}>AI Trainer</th>
                  <th className={TH}>This week</th>
                  <th className={TH}>Streak</th>
                  <th className={TH}>Last seen</th>
                  <th className={TH}>Linked</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const [label, tone] = ACCESS[r.access] ?? [r.access, "neutral" as Tone];
                  return (
                    <tr key={r.id} className={TR}>
                      <td className={TD}>
                        <div className="font-medium">{r.name || "—"}</div>
                        <div className="text-xs text-muted">{r.email}</div>
                      </td>
                      <td className={TD}>
                        {r.gymMember ? (
                          <Link className="underline" href={`/members/${r.gymMember.id}`}>
                            {r.gymMember.code} · {r.gymMember.name}
                          </Link>
                        ) : (
                          <span className="text-muted">Not matched to a member</span>
                        )}
                      </td>
                      <td className={TD}>
                        <Badge tone={tone}>{label}</Badge> <span className="text-xs text-muted">{findPlan(r.plan)?.name ?? r.plan}{r.paidUntil && r.access === "ACTIVE" ? ` · till ${fmtShort(r.paidUntil)}` : ""}</span>
                      </td>
                      <td className={`${TD} tabular-nums`}>
                        {r.weekWorkouts}/{r.weekPlanned} workouts
                      </td>
                      <td className={`${TD} tabular-nums`}>{r.streak ? `${r.streak} days` : "—"}</td>
                      <td className={TD}>{r.lastSeenAt ? fmtStamp(r.lastSeenAt) : "—"}</td>
                      <td className={TD}>{r.linkedAt ? fmtStamp(r.linkedAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        )}
        <p className="mt-3 text-xs text-muted">A member is matched to their gym record by the email they signed in with, or the phone they gave the app. Unmatched members are counted for your share all the same.</p>
      </Card>
    </div>
  );
}
