import { redirect } from "next/navigation";
import { LockSimpleIcon, SignOutIcon } from "@phosphor-icons/react/dist/ssr";
import { requireUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { gymPlan } from "@/lib/services/saas";
import { getGymProfile } from "@/lib/services/settings";
import { gymLogoUrl } from "@/components/gym-logo";
import { fitronKeyId } from "@/lib/integrations/razorpay";
import { gymPlanCards } from "@/lib/domain/saas";
import { addDays } from "@/lib/domain/dates";
import { Notice } from "@/components/ui";
import { PlanCards } from "@/components/plan-cards";
import { SideLogo } from "@/components/side-logo";
import { fmtDate } from "@/lib/format";
import { logout } from "@/app/login/actions";

export const metadata = { title: "Choose a plan · Fitron" };

/**
 * Where a gym lands once its free trial (or paid plan and its grace days) has ended: the landing
 * page's plans, to pay. Nothing else in the app opens until a payment is made.
 */
export default async function PlanEndedPage() {
  const u = await requireUser({ allowBlocked: true });
  if (!u.planBlocked) redirect("/dashboard");
  const [plan, paidBefore, owner, profile] = await Promise.all([
    gymPlan(u.orgId),
    db.branchSubscription.count({ where: { orgId: u.orgId, kind: "PLAN", status: "PAID" } }),
    db.user.findFirst({ where: { orgId: u.orgId, active: true, role: { name: "Super Admin" } }, orderBy: { createdAt: "asc" }, select: { name: true, email: true } }),
    getGymProfile(u.orgId),
  ]);
  const ended = plan.standing.kind === "LAPSED" ? addDays(plan.standing.since, -1) : null;
  const canPay = u.can("settings.manage");
  // Payments to FITRON go through Razorpay (see startPayment): the plan renews by itself.
  const razorpay = fitronKeyId() !== null;
  const demo = !razorpay;

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between gap-4 border-b border-line-soft px-4 py-3 lg:px-10">
        <div className="w-[160px]">
          <SideLogo src={gymLogoUrl(profile.logoKey)} name={profile.name} />
        </div>
        <form action={logout}>
          <button className="inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-accent hover:bg-accent/10">
            <SignOutIcon size={16} weight="duotone" />
            Sign out
          </button>
        </form>
      </header>
      <main className="mx-auto flex max-w-[1180px] flex-col gap-8 px-4 py-10 lg:px-10">
        <div className="flex flex-col gap-3">
          <span className="grid size-12 place-items-center rounded-full bg-alert-soft">
            <LockSimpleIcon size={24} weight="duotone" className="text-alert-700" />
          </span>
          <div className="text-[11px] tracking-[0.1em] text-muted uppercase">{profile.name}</div>
          <h1 className="text-[28px] lg:text-[40px]">{paidBefore ? "Your FITRON plan has ended" : "Your 7-day free trial has ended"}</h1>
          <p className="max-w-2xl text-[15px] text-fg/85">
            {ended ? `It ended on ${fmtDate(ended)}. ` : ""}Your members, invoices, payments and reports are safe and nothing has been deleted.{" "}
            {canPay ? "Choose a plan and pay to open FITRON again; it opens as soon as the payment is made." : "FITRON opens again as soon as the gym's plan is paid."}
          </p>
        </div>

        {canPay ? (
          <>
            {razorpay && (
              <Notice tone="neutral">
                You chose the {plan.name} plan ({plan.cycle === "YEARLY" ? "yearly" : "monthly"}) when you signed up. Pay for it below with Razorpay (UPI AutoPay, card or net banking): it opens FITRON again straight away, and renews by itself each {plan.cycle === "YEARLY" ? "year" : "month"} until you stop it in Settings › Plan & billing. GST is included in the price.
              </Notice>
            )}
            {demo && <Notice>Demo mode: FITRON&apos;s Razorpay keys aren&apos;t set on this server, so payments are simulated and no money is charged.</Notice>}
            <PlanCards plans={gymPlanCards()} current={plan.key} startCycle={plan.cycle} autoRenew={razorpay} labels={{ current: "Pay", other: "Choose" }} />
          </>
        ) : (
          <Notice tone="alert">
            Only the gym&apos;s owner can choose a plan. Ask {owner ? `${owner.name} (${owner.email})` : "your gym's Super Admin"} to sign in and pay.
          </Notice>
        )}
        <p className="text-sm text-muted">
          Questions about plans or payment? Write to{" "}
          <a href="mailto:hello@fitron.in" className="text-accent">
            hello@fitron.in
          </a>
          .
        </p>
      </main>
    </div>
  );
}
