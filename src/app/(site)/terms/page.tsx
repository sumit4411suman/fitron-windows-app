import { LegalPage } from "../legal";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Terms & Conditions | FITRON", description: "Read FITRON's Terms & Conditions for AI Trainer, Gym Accounting, subscriptions, payments, partnerships and acceptable use.", path: "/terms" });

const TOC = [
  ["accounts", "Accounts"],
  ["trials", "Free trials, plans and payment"],
  ["ai", "AI Trainer: health notice"],
  ["gym", "Gym Accounting responsibilities"],
  ["partners", "Gym Partner & Customer Policy"],
  ["use", "Acceptable use"],
  ["availability", "Availability and liability"],
  ["ending", "Ending your account"],
  ["law", "Law and disputes"],
] as const;

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      toc={TOC}
      updated="5 October 2026"
      intro={<p>These terms apply when you use fitron.in, the FITRON AI Trainer, FITRON Gym Accounting or a FITRON Gym Partnership. By creating an account or starting a trial you agree to them.</p>}
    >
      <section>
        <h2 id="accounts">Accounts</h2>
        <ul>
          <li>You must be 18 or over and give accurate details.</li>
          <li>Keep your password private. You are responsible for what happens under your account, and a gym is responsible for the staff accounts it creates.</li>
        </ul>
      </section>
      <section>
        <h2 id="trials">Free trials, plans and payment</h2>
        <ul>
          <li>AI Trainer and Gym Accounting plans start with a 7-day free trial. No card is needed.</li>
          <li>Prices are in Indian rupees and include GST (18%), so you pay exactly the listed price. Current prices are on the <a href="/#pricing">pricing page</a>.</li>
          <li>Plans are paid in advance for a month or a year, and renew automatically for the same period at the listed price until you cancel. Renewals are collected through Razorpay, by the UPI AutoPay, card or net-banking mandate you approve when you pay.</li>
          <li>You can cancel at any time from Settings › Plan &amp; billing (Gym Accounting) or Settings › Subscription (AI Trainer). Cancel before your next renewal date to avoid the next charge. Your plan stays active until the end of the period you have paid for. That period is not refunded, except as the <a href="/refund">Refund Policy</a> says.</li>
          <li>If a renewal payment fails, your plan stays active until the end of the period already paid. After that the plan ends; a Gym Accounting plan then has 7 days&apos; grace before the gym becomes read-only. Your records are kept, and paying switches it back on.</li>
          <li>Gym Accounting plans have member limits (Starter 100, Professional 300 active members; Enterprise unlimited). Extra branches cost ₹499 a month each.</li>
          <li>Refunds follow our <a href="/refund">Refund Policy</a>.</li>
        </ul>
      </section>
      <section>
        <h2 id="ai">AI Trainer: health notice</h2>
        <p>The AI Trainer gives general fitness and nutrition guidance. It is not medical advice and does not replace a doctor, physiotherapist or dietitian. Check with a doctor before starting a new exercise or diet plan, especially if you have a medical condition, an injury, or are pregnant. Stop exercising and seek help if you feel pain, dizziness or breathlessness.</p>
        <p>AI replies can be wrong. Use your judgement, and don&apos;t rely on them for anything medical.</p>
      </section>
      <section>
        <h2 id="gym">Gym Accounting: your data and your responsibilities</h2>
        <ul>
          <li>The gym owns its data and its members&apos; data. We process it only to run the service. You can export it at any time.</li>
          <li>The gym is responsible for having its members&apos; consent, for the accuracy of invoices and GST filings, and for its own tax compliance. FITRON is a tool, not your accountant.</li>
          <li>Payments to the gym (UPI, Razorpay) go straight to the gym&apos;s own account. FITRON is not a party to them.</li>
        </ul>
      </section>
      <section>
        <h2 id="partners">Gym Partner &amp; Customer Policy</h2>
        <ul>
          <li>All partner plans need a paid subscription and a signed partnership agreement.</li>
          <li>Partners earn 70% of eligible AI Trainer subscription revenue attributed to them, calculated after taxes, refunds, chargebacks and agreed payment-processing charges, and settled monthly after verification.</li>
          <li>Partners promote the AI Trainer to their members; FITRON provides the platform, AI technology and subscription infrastructure.</li>
          <li>Partners may not resell or sublicense the software outside the agreement. Custom branding, extra branches and integrations may cost extra.</li>
          <li>Revenue examples on fitron.in are illustrative, not guaranteed earnings. The signed agreement prevails over this summary.</li>
        </ul>
      </section>
      <section>
        <h2 id="use">Acceptable use</h2>
        <p>Don&apos;t misuse the service: no unlawful content, no spam through WhatsApp or email, no attempts to break security or access other customers&apos; data, and no reverse engineering.</p>
      </section>
      <section>
        <h2 id="availability">Availability and liability</h2>
        <p>We work to keep FITRON available and back up data every night, but we can&apos;t promise it will never be interrupted. To the extent the law allows, our total liability for any claim is limited to the fees you paid us in the 12 months before it.</p>
      </section>
      <section>
        <h2 id="ending">Ending your account</h2>
        <p>You can stop using FITRON at any time. We may suspend accounts that break these terms or don&apos;t pay, after notice where possible. Gyms can export their data for 30 days after their plan ends.</p>
      </section>
      <section>
        <h2 id="law">Law and disputes</h2>
        <p>These terms are governed by the laws of India. Write to <a href="mailto:hello@fitron.in">hello@fitron.in</a> first and we&apos;ll try to resolve it.</p>
      </section>
    </LegalPage>
  );
}
