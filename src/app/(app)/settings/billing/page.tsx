import Image from "next/image";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { activeMemberCount, autoRenewals, billingHistory, branchStandings, gymPlan } from "@/lib/services/saas";
import { fitronKeyId } from "@/lib/integrations/razorpay";
import { PLANS, rupeesLabel } from "@/lib/domain/pricing";
import { SERVICES, findService } from "@/lib/domain/services";
import { branchPrice, GRACE_DAYS, gymPlanCards, type PlanStanding, type Standing } from "@/lib/domain/saas";
import { PlanCards } from "@/components/plan-cards";
import { FEATURES, planFor, type Feature } from "@/lib/domain/features";
import { Badge, Button, cx, Empty, Field, Input, LinkButton, Notice, Select, TABLE, TD, TH, TR, ScrollRegion } from "@/components/ui";
import { SettingsShell } from "@/components/section-tabs";
import { fmtDate, formatInr } from "@/lib/format";
import { getSubscriptionSettings, gymWhatsAppNumber } from "@/lib/services/subscription";
import { REMIND_DAYS } from "@/lib/domain/saas";
import { PayButton } from "./pay-button";
import { ServicePay, StopRenewal } from "./billing-extras";
import { saveBillingDetails, saveRenewalReminders } from "./actions";

export const metadata = { title: "Plan & billing · Fitron" };

function StandingBadge({ s }: { s: Standing }) {
  if (s.kind === "INCLUDED") return <Badge>Included</Badge>;
  if (s.kind === "PAID") return <Badge tone="ok">Paid till {fmtDate(s.until)}</Badge>;
  if (s.kind === "GRACE") return <Badge tone="accent">Grace till {fmtDate(s.readOnlyFrom)}</Badge>;
  if (s.kind === "CLOSED") return <Badge>Closed</Badge>;
  return <Badge tone="alert">Read-only</Badge>;
}

function PlanBadge({ s }: { s: PlanStanding }) {
  if (s.kind === "CUSTOM") return <Badge tone="ok">Set up by FITRON</Badge>;
  if (s.kind === "TRIAL") return <Badge tone="accent">Free trial till {fmtDate(s.until)}</Badge>;
  if (s.kind === "PAID") return <Badge tone="ok">Paid till {fmtDate(s.until)}</Badge>;
  if (s.kind === "GRACE") return <Badge tone="accent">Grace till {fmtDate(s.readOnlyFrom)}</Badge>;
  return <Badge tone="alert">Ended · read-only</Badge>;
}

/** A settings card as the prototype draws it: 20/22 padding, hairline border, 18px heading with a quiet line under it. */
function Sub({ title, sub, id, children }: { title: string; sub?: React.ReactNode; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-3.5 rounded-lg border border-line bg-surface px-[22px] py-5">
      <div>
        <h3 className="text-lg">{title}</h3>
        {sub && <div className="mt-0.5 text-[13px] text-muted">{sub}</div>}
      </div>
      {children}
    </section>
  );
}

const KICKER = "text-[11px] tracking-[0.1em] text-muted uppercase";

const REMIND_LABEL: Record<number, string> = {
  14: "14 days before",
  7: "7 days before",
  3: "3 days before",
  1: "1 day before",
};
/** "919000000001" → "+91 9000000001" */
const showNumber = (n: string) => `+${n.slice(0, 2)} ${n.slice(2)}`;
const prices = (f: (c: "MONTHLY" | "YEARLY") => { total: number }) => ({
  MONTHLY: f("MONTHLY").total,
  YEARLY: f("YEARLY").total,
});

export default async function BillingPage({ searchParams }: PageProps<"/settings/billing">) {
  const u = await requirePermission("settings.manage");
  const sp = await searchParams;
  const upgrade = typeof sp.upgrade === "string" && sp.upgrade in FEATURES ? (sp.upgrade as Feature) : null;
  const [{ branches, freeSlots, terms }, history, plan, members, sub, gymNumber, renewals] = await Promise.all([branchStandings(u.orgId), billingHistory(u), gymPlan(u.orgId), activeMemberCount(db, u.orgId), getSubscriptionSettings(u.orgId), gymWhatsAppNumber(u.orgId), autoRenewals(u.orgId)]);
  const paidTotal = history.filter((h) => h.status === "PAID").reduce((a, h) => a + h.total, 0);
  // Payments to FITRON go through Razorpay; without its keys a live server takes none (see startPayment).
  const razorpay = fitronKeyId() !== null;
  const demo = !razorpay;
  const y = branchPrice("YEARLY");
  const m = branchPrice("MONTHLY");
  const openBranches = branches.filter((b) => b.standing.kind !== "CLOSED");
  const extra = openBranches.filter((b) => b.standing.kind !== "INCLUDED").length;
  const s = plan.standing;
  const renewing = s.kind === "PAID" || s.kind === "GRACE";

  return (
    <SettingsShell u={u} current="/settings/billing">
      <div className="flex max-w-[760px] flex-col gap-[18px]">
        <div className="flex flex-col gap-2">
          {typeof sp.saved === "string" && <Notice tone="ok">Saved. Changes are recorded in the audit log.</Notice>}
          {typeof sp.error === "string" && <Notice tone="alert">{sp.error}</Notice>}
          {upgrade && (
            <Notice tone="accent">
              <strong>{FEATURES[upgrade].label}</strong> is on the <strong>{planFor(upgrade).name}</strong> plan ({FEATURES[upgrade].card}). Your gym is on {plan.name}. Pick {planFor(upgrade).name} below; it opens as soon as the payment is confirmed.
            </Notice>
          )}
          {demo && <Notice>Demo mode: FITRON&apos;s Razorpay keys aren&apos;t set on this server, so payments are simulated and no money is charged.</Notice>}
          {razorpay && (
            <Notice tone="neutral">
              You pay online with Razorpay (UPI AutoPay, card or net banking). A plan renews by itself each month or year until you stop it under Automatic renewals; GST is included in every price.
            </Notice>
          )}
        </div>
        <section className="flex flex-col gap-3.5 rounded-lg border border-t-2 border-line border-t-accent bg-surface px-[22px] py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Image src="/fitron-mark.png" alt="" width={44} height={44} className="size-11 object-contain" />
              <div>
                <div className={KICKER}>Your Fitron plan</div>
                <div className="mt-0.5 text-[22px] font-semibold">{terms.custom ? "Set up by FITRON" : `${plan.name} · ${plan.cycle === "YEARLY" ? "yearly" : "monthly"}`}</div>
              </div>
            </div>
            <PlanBadge s={s} />
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
            {[
              s.kind === "TRIAL" ? ["Trial ends", fmtDate(s.until)] : s.kind === "PAID" ? ["Paid until", fmtDate(s.until)] : s.kind === "GRACE" ? ["Read-only from", fmtDate(s.readOnlyFrom)] : s.kind === "LAPSED" ? ["Locked since", fmtDate(s.since)] : ["Plan", "Custom"],
              ["Members", `${members}${terms.memberLimit !== null ? ` of ${terms.memberLimit}` : ""}`],
              ["Branches", String(branches.length)],
              ["Total paid", formatInr(paidTotal)],
            ].map(([k, v]) => (
              <div key={k}>
                <div className={KICKER}>{k}</div>
                <div className="mt-[3px] text-[17px]">{v}</div>
              </div>
            ))}
          </div>
          {terms.custom ? (
            <p className="text-sm">FITRON set up your gym by hand, so it has no member limit and {terms.includedBranches} branches are included. Extra branches are paid below. Write to hello@fitron.in to move to a listed plan.</p>
          ) : (
            <div className="flex flex-col gap-4 text-sm">
              {s.kind === "LAPSED" && <p className="text-alert">Your plan has ended, so no new members or invoices can be added. Nothing is deleted; paying switches it back on at once.</p>}
              {s.kind === "GRACE" && (
                <p className="text-muted">
                  Your paid period ended on {fmtDate(s.until)}. Renew before {fmtDate(s.readOnlyFrom)} to keep adding members and invoices.
                </p>
              )}
              <PlanCards
                plans={gymPlanCards()}
                current={plan.key}
                autoRenew={razorpay}
                startCycle={plan.cycle}
                labels={{
                  current: renewing ? "Renew" : "Pay",
                  other: "Switch",
                }}
              />
              <p className="text-xs text-muted">A new plan applies as soon as it&apos;s paid. The paid period starts after your current one (or after the free trial), so you never lose days.</p>
            </div>
          )}
        </section>
        {(razorpay || renewals.length > 0) && (
          <Sub title="Automatic renewals" sub="Plans and branches that Razorpay charges again by itself. Stopping one keeps it active to the end of the period you already paid for.">
            {renewals.length === 0 ? (
              <Empty>Nothing renews automatically yet. Pay for a plan above and it renews by itself until you stop it here.</Empty>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {renewals.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-medium">
                        {r.what} · {r.cycle === "YEARLY" ? "yearly" : "monthly"}
                      </div>
                      <div className={r.stopPending ? "text-alert" : "text-muted"}>
                        {r.stopPending ? "We couldn't confirm with Razorpay that this renewal has stopped, so it may still be charged. Try stopping it again." : r.status === "pending" ? "The last renewal charge failed; Razorpay is trying again." : r.nextChargeAt ? `Next charge ${fmtDate(r.nextChargeAt)}` : "Next charge date shows after the first payment is confirmed."}
                      </div>
                    </div>
                    <StopRenewal id={r.id} what={r.what} retry={r.stopPending} />
                  </li>
                ))}
              </ul>
            )}
          </Sub>
        )}
        {!terms.custom && (
          <Sub title="Gym Partnership plans" sub="Promote the AI Trainer to your members and earn 70% of their subscriptions. Software and Enterprise partners also get the matching Gym Accounting plan.">
            <ul className="divide-y divide-line text-sm">
              {PLANS.filter((p) => p.product === "PARTNER").map((p) => (
                <li key={p.key} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted"> · {rupeesLabel(p.price.MONTHLY)} / month or {rupeesLabel(p.price.YEARLY)} / year, GST included</span>
                    </div>
                    {plan.key === p.key && <Badge tone="ok">Your plan</Badge>}
                  </div>
                  <p className="text-muted">{p.tagline}</p>
                  <PayButton what={{ kind: "PLAN", plan: p.key }} label={plan.key === p.key ? "Renew" : "Choose"} prices={{ MONTHLY: p.price.MONTHLY, YEARLY: p.price.YEARLY }} success={`Paid. You're on ${p.name}.`} />
                </li>
              ))}
            </ul>
          </Sub>
        )}
        <Sub title="Add-ons" sub="Setup, branding and extras, paid once, GST included. After you pay, the FITRON team contacts you to agree the scope and start. Custom work is quoted first: pay the amount we agreed.">
          <ul className="divide-y divide-line text-sm">
            {SERVICES.map((svc) => (
              <li key={svc.key} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{svc.name}</span>
                  <span className="text-muted">
                    {svc.quoted ? "from " : ""}
                    {rupeesLabel(svc.price)}
                  </span>
                </div>
                <ServicePay service={svc.key} name={svc.name} price={svc.price} quoted={svc.quoted} />
              </li>
            ))}
          </ul>
        </Sub>
        <Sub title="Renewal reminders" sub="FITRON reminds you before your plan or trial ends so the account never locks by surprise.">
          <form action={saveRenewalReminders} className="flex flex-col gap-4">
            <Field label="Remind me" className="max-w-[260px]">
              <Select name="remindDays" defaultValue={String(sub.remindDays)}>
                {REMIND_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {REMIND_LABEL[d]}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex flex-wrap items-center gap-2.5 text-sm">
              <input type="checkbox" name="whatsapp" defaultChecked={sub.whatsapp} className="size-[18px] accent-accent" />
              WhatsApp reminder to the gym number
              <span className="text-muted">{gymNumber ? `· to ${showNumber(gymNumber)}` : "· add a phone in Gym profile first"}</span>
            </label>
            <label className="flex flex-wrap items-center gap-2.5 text-sm">
              <input type="checkbox" name="email" defaultChecked={sub.email} className="size-[18px] accent-accent" />
              Email reminder to the billing email
              <span className="text-muted">{sub.billingEmail ? `· to ${sub.billingEmail}` : "· to every Super Admin's sign-in email until a billing email is set"}</span>
            </label>
            <div>
              <Button variant="primary">Save</Button>
            </div>
          </form>
          <p className="text-xs text-muted">
            Reminders are also shown in the bell and on this page. Sent by the daily job &quot;Plan and branch renewal reminders&quot; (
            <Link href="/settings/jobs" className="underline">
              Settings › Daily jobs
            </Link>
            ).
          </p>
        </Sub>
        <Sub title="Billing details" sub="Printed on your FITRON receipts. Add your GSTIN to claim input tax credit.">
          <form action={saveBillingDetails} className="flex flex-col gap-4">
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
              <Field label="Legal / business name">
                <Input name="legalName" defaultValue={sub.legalName} placeholder="Power Haus Gym" maxLength={120} />
              </Field>
              <Field label="GSTIN (optional)">
                <Input name="gstin" defaultValue={sub.gstin} placeholder="20ABCDE1234F1Z5" maxLength={15} className="uppercase" />
              </Field>
              <Field label="Billing email">
                <Input name="billingEmail" type="email" defaultValue={sub.billingEmail} placeholder="accounts@yourgym.in" maxLength={120} />
              </Field>
              <Field label="Billing address">
                <Input name="address" defaultValue={sub.address} placeholder="C-7, Sector 4, City Centre, Bokaro" maxLength={300} />
              </Field>
            </div>
            <div>
              <Button variant="primary">Save</Button>
            </div>
          </form>
          <p className="text-xs text-muted">Leave the name blank to use your gym name; leave the GSTIN blank to use the GSTIN of your first branch.</p>
        </Sub>
        <Sub title="Payment history">
          {history.length === 0 ? (
            <Empty>No payments yet. Your receipts will appear here.</Empty>
          ) : (
            <ScrollRegion label="Billing table">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Receipt</th>
                    <th className={TH}>Date</th>
                    <th className={TH}>Plan</th>
                    <th className={TH}>Payment ID</th>
                    <th className={TH}>Valid till</th>
                    <th className={cx(TH, "text-right")}>Amount</th>
                    <th className={TH}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const what =
                      h.kind === "PLAN"
                        ? `${PLANS.find((p) => p.key === h.plan)?.name ?? h.plan} plan · ${h.cycle === "YEARLY" ? "Yearly" : "Monthly"}`
                        : h.kind === "SERVICE"
                          ? `Add-on · ${findService(h.plan)?.name ?? h.plan}`
                          : `Extra branch · ${h.branchId ? (branches.find((b) => b.id === h.branchId)?.name ?? "") : "not used yet"}`;
                    return (
                      <tr key={h.id} className={TR}>
                        <td className={cx(TD, "whitespace-nowrap")}>{h.invoiceNo ?? "—"}</td>
                        <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(h.paidAt ?? h.createdAt)}</td>
                        <td className={TD}>
                          {what}
                          {h.mode === "DEMO" ? " · demo" : h.mode === "SUBSCRIPTION" ? " · renews automatically" : ""}
                          {h.couponCode ? ` · coupon ${h.couponCode}` : ""}
                        </td>
                        <td className={cx(TD, "tabular-nums")}>{h.razorpayPaymentId ?? "—"}</td>
                        <td className={cx(TD, "whitespace-nowrap")}>{h.status === "PAID" && h.periodEnd ? fmtDate(h.periodEnd) : "—"}</td>
                        <td className={cx(TD, "text-right font-semibold tabular-nums")}>{formatInr(h.total)}</td>
                        <td className={cx(TD, "text-right")}>
                          {h.status === "PAID" && (
                            <LinkButton href={`/settings/billing/${h.id}`} variant="ghost">
                              Receipt
                            </LinkButton>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </Sub>
        <Sub title={`Branches · ${openBranches.length - extra} included${extra ? ` + ${extra} extra` : ""}`}>
          <ul className="divide-y divide-line text-sm">
            {branches.map((b) => (
              <li key={b.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{b.name}</span>
                  <StandingBadge s={b.standing} />
                </div>
                {b.standing.kind === "GRACE" && (
                  <p className="text-muted">
                    The paid period ended on {fmtDate(b.standing.until)}. Renew before {fmtDate(b.standing.readOnlyFrom)} to keep adding members and invoices.
                  </p>
                )}
                {b.standing.kind === "READ_ONLY" && <p className="text-muted">Records are kept and can be viewed, but no new members or invoices until it is renewed.</p>}
                {b.standing.kind !== "INCLUDED" && b.standing.kind !== "CLOSED" && terms.extraBranches && <PayButton what={{ kind: "BRANCH", branchId: b.id }} label="Renew" prices={prices(branchPrice)} success="Paid. The branch is renewed." />}
              </li>
            ))}
          </ul>
        </Sub>
        <Sub title="Add another branch" id="add-branch">
          {!terms.extraBranches ? (
            <p className="text-sm">
              {plan.name} is for one branch. Enterprise includes 3 branches, and more cost {formatInr(m.total)} a month each, GST included.
            </p>
          ) : freeSlots.length > 0 ? (
            <p className="text-sm">
              You have {freeSlots.length} paid branch slot
              {freeSlots.length === 1 ? "" : "s"} ready.{" "}
              <Link href="/settings?tab=branches&branch=new" className="text-accent underline underline-offset-2">
                Add the branch in Settings
              </Link>
              .
            </p>
          ) : openBranches.length < terms.includedBranches ? (
            <p className="text-sm">
              You can add {terms.includedBranches - openBranches.length} more branch
              {terms.includedBranches - openBranches.length === 1 ? "" : "es"} at no cost.{" "}
              <Link href="/settings?tab=branches&branch=new" className="text-accent underline underline-offset-2">
                Add it in Settings
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <p>
                Each extra branch is {formatInr(m.total)} a month or {formatInr(y.total)} a year, GST included. Yearly saves {formatInr(m.total * 12 - y.total)} on monthly.{razorpay ? " Monthly renews automatically; yearly is one payment you renew yourself." : ""}
              </p>
              <PayButton what={{ kind: "BRANCH", branchId: null }} label="Pay for a branch" prices={prices(branchPrice)} success="Paid. Now add the new branch in Settings › Branches." />
            </div>
          )}
        </Sub>
        <Sub title="How renewals work">
          <p className="text-sm text-muted">
            {razorpay && "A plan or branch paid through Razorpay renews by itself each period until you stop it under Automatic renewals; if a renewal fails, Razorpay tries again and you are told here and by email. "}
            You get a reminder before your trial or a paid period ends. After a paid period there are {GRACE_DAYS} days&apos; grace, then the gym (or that extra branch) turns read-only. Nothing is ever deleted, and paying switches it back on at once.
          </p>
        </Sub>
      </div>
    </SettingsShell>
  );
}
