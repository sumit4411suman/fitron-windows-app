import { redirect } from "next/navigation";
import { TrialForm } from "./trial-form";
import { DEFAULT_PLAN, PRODUCT_LABEL, findPlan, rupeesLabel } from "@/lib/domain/pricing";
import { gymSignupHref, trainerHref } from "@/lib/domain/site-links";

export const metadata = { title: "Start your free trial · FITRON", description: "Start a 7-day free trial of FITRON AI Trainer or Gym Accounting. No card needed." };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const q = await searchParams;
  const plan = findPlan(typeof q.plan === "string" ? q.plan : null) ?? findPlan(DEFAULT_PLAN)!;
  const cycle = q.cycle === "YEARLY" || q.cycle === "year" ? "YEARLY" : "MONTHLY";
  // Each trial opens its own product's sign-in, with the plan picked on fitron.in: AI Trainer plans in the
  // member app (email link or Google), Gym Accounting plans on the console's "Create account" tab.
  if (plan.product === "AI_TRAINER") redirect(trainerHref(plan.key));
  if (plan.product === "GYM_ACCOUNTING") redirect(gymSignupHref({ plan: plan.key, cycle, google: typeof q.google === "string" ? q.google : null }));
  // What is left are the partner plans, which are set up with the team.
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,26rem)]">
      <section>
        <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-accent uppercase">
          {plan.trialDays ? `${plan.trialDays}-day free trial · no card needed` : "Gym partnership"}
        </p>
        <h1 className="text-4xl leading-tight font-semibold sm:text-5xl">
          {PRODUCT_LABEL[plan.product]} {plan.name}
        </h1>
        <p className="mt-4 max-w-lg text-lg text-muted">{plan.tagline}</p>
        <p className="mt-6 text-2xl font-semibold">
          {rupeesLabel(plan.price.MONTHLY)} <span className="text-base font-normal text-muted">/ month, or {rupeesLabel(plan.price.YEARLY)} / year, GST included</span>
        </p>
        <ol className="mt-8 flex max-w-lg flex-col gap-3 text-muted">
          <li><b className="text-fg">1.</b> Send this form. It takes a minute.</li>
          <li><b className="text-fg">2.</b> We call or WhatsApp you within one working day and set up your account.</li>
          <li><b className="text-fg">3.</b> {plan.trialDays ? "Use everything free for 7 days. Pay online only if you want to continue (UPI AutoPay, card or net banking); plans renew automatically and you can cancel any time." : "Sign the partnership agreement and go live."}</li>
        </ol>
        <p className="mt-8 text-sm text-muted">
          Already have an account? <a href="/signin" className="text-accent underline">Sign in</a>
        </p>
      </section>
      <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
        <TrialForm plan={plan.key} cycle={cycle} />
      </section>
    </div>
  );
}
