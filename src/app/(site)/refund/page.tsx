import { LegalPage } from "../legal";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Refund Policy | FITRON",
  description: "Read FITRON's refund and cancellation policy for AI Trainer, Gym Accounting and partnership plans.",
  path: "/refund",
});

const TOC = [
  ["trial", "Free trial"],
  ["cancel", "Cancelling"],
  ["when", "Eligible refunds"],
  ["not-refundable", "Non-refundable payments"],
  ["how", "How to request a refund"],
  ["processing", "Processing time"],
  ["gym-members", "Gym membership payments"],
] as const;

// What a visitor needs at a glance. Every line restates a rule written out in full in the sections below.
const GLANCE = [
  ["Free trial", "7 days, no card needed"],
  ["Cancel", "Any time, from Settings"],
  ["Refund window", "7 days from your first payment"],
  ["We reply within", "2 working days"],
  ["Money back in", "5 to 7 working days"],
] as const;

const card = "s-card p-5 sm:p-6";

export default function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      updated="5 October 2026"
      toc={TOC}
      intro={<p>Every FITRON plan starts with a 7-day free trial, so you can try everything before you pay. This policy covers payments made to FITRON for AI Trainer, Gym Accounting and partner plans.</p>}
      summary={
        <dl className="mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
          {GLANCE.map(([k, v]) => (
            <div key={k} className="s-card p-4">
              <dt className="s-eyebrow">{k}</dt>
              <dd className="mt-1 font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      }
    >
      <section id="trial" className={card}>
        <h2>Free trial</h2>
        <p>The trial is free and needs no card. If you don&apos;t pay when it ends, nothing is charged.</p>
      </section>
      <section id="cancel" className={card}>
        <h2>Cancelling</h2>
        <p>Plans renew automatically until you cancel. You can cancel at any time from Settings › Plan &amp; billing (Gym Accounting) or Settings › Subscription (AI Trainer). Your plan stays active until the end of the period you paid for, and is not renewed after that.</p>
      </section>
      <section id="when" className={`${card} border-ok/50`}>
        <h2>Eligible refunds</h2>
        <ul>
          <li><b>Charged twice or charged by mistake:</b> full refund of the extra amount.</li>
          <li><b>Paid but we couldn&apos;t activate your plan</b> within 2 working days: full refund.</li>
          <li><b>First paid month or year, cancelled within 7 days of payment:</b> full refund if you tell us within those 7 days.</li>
        </ul>
      </section>
      <section id="not-refundable" className={`${card} border-alert/50`}>
        <h2>Non-refundable payments</h2>
        <p>Otherwise, payments for a period that has started are not refundable, including unused days of a monthly or yearly plan. One-time setup, branding and migration fees are refundable only if the work hasn&apos;t started.</p>
      </section>
      <section id="how" className={card}>
        <h2>How to request a refund</h2>
        <p>Write to <a href="mailto:hello@fitron.in?subject=Refund%20request">hello@fitron.in</a> or use the <a href="/contact?topic=support">contact form</a> with your registered email and the Razorpay payment ID. We reply within 2 working days.</p>
      </section>
      <section id="processing" className={card}>
        <h2>Processing time</h2>
        <p>Approved refunds go back to the original payment method within 5 to 7 working days. GST is refunded with the amount it was charged on.</p>
      </section>
      <section id="gym-members" className={card}>
        <h2>Gym membership payments</h2>
        <p>If you paid a gym for a membership, that payment went to the gym, not to FITRON. Ask the gym about refunds.</p>
      </section>
      <p className="text-sm text-muted">
        These rules are part of our <a href="/terms">Terms &amp; Conditions</a>; how we handle your data is in the <a href="/privacy">Privacy Policy</a>.
      </p>
    </LegalPage>
  );
}
