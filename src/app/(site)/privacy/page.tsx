import { LegalPage } from "../legal";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Privacy Policy | FITRON", description: "Read FITRON's Privacy Policy covering personal data, AI Trainer, Gym Accounting, cookies, security and your rights under India's DPDP Act.", path: "/privacy" });

const TOC = [
  ["collect", "What we collect"],
  ["use", "How we use it"],
  ["sharing", "Who we share it with"],
  ["storage", "Where it is kept and for how long"],
  ["rights", "Your DPDP rights"],
  ["cookies", "Cookies"],
  ["security", "Security"],
  ["dpa", "Data Processing terms"],
  ["children", "Children"],
  ["grievance", "Grievance Officer"],
  ["changes", "Changes"],
] as const;

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      toc={TOC}
      updated="6 October 2026"
      intro={<p>FITRON (&quot;we&quot;) runs fitron.in, the FITRON AI Trainer and FITRON Gym Accounting. This policy explains what personal data we collect, why, and the rights you have under India&apos;s Digital Personal Data Protection Act, 2023 (DPDP Act). Your use of FITRON is also covered by our <a href="/terms">Terms &amp; Conditions</a>.</p>}
    >
      <section>
        <h2 id="collect">What we collect</h2>
        <ul>
          <li><b>Account details:</b> name, email, mobile number, and for gyms the business name, address and GSTIN.</li>
          <li><b>AI Trainer data you give us:</b> age, height, weight, goals, diet preference, equipment, workouts, meals and messages to the AI coach.</li>
          <li><b>Gym Accounting data a gym enters:</b> its members, plans, invoices, payments, expenses, staff and attendance. For this data the gym decides what is collected and why; we process it on the gym&apos;s instructions.</li>
          <li><b>Payments:</b> payment references and status from our payment partners. We never see or store your card details or UPI PIN.</li>
          <li><b>Technical data:</b> IP address, device and browser type, and essential cookies needed to keep you signed in.</li>
        </ul>
      </section>
      <section>
        <h2 id="use">How we use it</h2>
        <ul>
          <li>To provide the service you signed up for, including AI-generated plans and coaching.</li>
          <li>To bill you, send invoices and reminders, and provide support.</li>
          <li>To keep the service secure and to meet legal, tax and accounting obligations.</li>
          <li>With your consent only: usage analytics on our public website, and product updates. You can withdraw consent at any time.</li>
        </ul>
        <p>We do not sell personal data and we do not use it for advertising. Members&apos; conversations with the AI coach are never shown to their gym.</p>
      </section>
      <section>
        <h2 id="sharing">Who we share it with</h2>
        <p>Only with service providers who help us run FITRON, under contract and only for that purpose: cloud hosting, payment processing (e.g. Razorpay), messaging (e.g. WhatsApp Business), email delivery, the AI model provider that generates coaching replies and, only if you agree to analytics on fitron.in, Google Analytics. We may disclose data when the law requires it.</p>
        <p><b>What the AI model provider receives.</b> When you chat with the AI coach, we send it your messages and what you told the app that it needs to coach you: your plan, and answers such as age, sex, height, weight, injuries, goals, diet, training schedule and, if you allow it, your city. We do not send your name or email. When gym staff use Fitron AI, we send their question and the details it looks up to answer it, such as member names, phone numbers, plans and dues, limited to what that staff member is allowed to see. The provider processes this on its own servers, which may be outside India, only to write the reply.</p>
        <p><b>Analytics on fitron.in.</b> If you choose &quot;Accept all&quot;, or tick &quot;Analytics&quot; under &quot;Manage settings&quot;, we may use Google Analytics 4 on our public pages (not inside Gym Accounting or the AI Trainer) to count which pages and buttons are used. Google receives your IP address, your browser and device details, a cookie identifier, and the address of the page and the button you use. We do not send it your name, email address or phone number, and we switch off Google&apos;s advertising features and Google signals, so it is used only to measure the site. Google processes this on its own servers, which may be outside India. If you do not agree, no Google script is loaded and nothing is sent to Google.</p>
        <p><b>Fitron Assistant on fitron.in.</b> When you ask the chat on our home page a question, we send the provider your messages in that chat so it can write the reply, and nothing else about you. Please don&apos;t type personal details, passwords, card numbers or OTPs into it. We do not store these conversations; your browser keeps the chat in that tab until you close it.</p>
      </section>
      <section>
        <h2 id="storage">Where it is kept and for how long</h2>
        <p>The data we store is hosted on servers in India. The AI model provider handles the AI requests described under &quot;Who we share it with&quot; on its own servers. We keep it while your account is active and afterwards only as long as the law requires (for example, tax records for 8 years). When you delete your account, other data is erased within 30 days, except encrypted backups, which expire within 14 days after that.</p>
      </section>
      <section>
        <h2 id="rights">Your DPDP rights</h2>
        <ul>
          <li>Access a summary of your personal data and how it is processed.</li>
          <li>Correct, complete or update your data.</li>
          <li>Erase your data and withdraw consent.</li>
          <li>Nominate another person to exercise these rights if you die or become unable to.</li>
          <li>Raise a grievance with us, and then with the Data Protection Board of India.</li>
        </ul>
        <p>Members of a gym that uses FITRON can also ask their gym directly. To use any right, write to <a href="mailto:hello@fitron.in?subject=DPDP%20request">hello@fitron.in</a>. We reply within 30 days.</p>
      </section>
      <section>
        <h2 id="cookies">Cookies</h2>
        <p>We use essential cookies to keep you signed in and to remember your cookie choice. With your consent we also remember preferences and use Google Analytics, which sets cookies named _ga and _ga_ followed by an identifier and lasting up to two years, to count how the public pages are used. We do not use advertising cookies. You can change your choice any time with &quot;Cookie settings&quot; at the bottom of fitron.in.</p>
      </section>
      <section>
        <h2 id="security">Security</h2>
        <p>Passwords are hashed with Argon2, connections use HTTPS, sensitive biometric templates are encrypted, staff access is limited by role, and every change in Gym Accounting is written to an audit log.</p>
      </section>
      <section>
        <h2 id="dpa">Data Processing terms</h2>
        <p>For your members&apos; and staff&apos;s personal data, your gym is the Data Fiduciary and FITRON is the Data Processor under the Digital Personal Data Protection Act, 2023. FITRON processes that data only on your instructions, to run the console for you.</p>
        <p>You will collect and enter members&apos; data lawfully, with their consent where the law requires it, keep it accurate, and respond to your members&apos; requests to access, correct or erase their data.</p>
        <p>FITRON will keep the data secure, process it only to provide the service, keep it confidential, tell you without undue delay about any breach affecting it, help you answer members&apos; requests, and delete or return it when your account ends.</p>
      </section>
      <section>
        <h2 id="children">Children</h2>
        <p>The AI Trainer is for people aged 18 and over. We do not knowingly process children&apos;s data without verifiable parental consent.</p>
      </section>
      <section>
        <h2 id="grievance">Grievance Officer</h2>
        <p>For any complaint about your data or this policy, write to the Grievance Officer, FITRON, at <a href="mailto:hello@fitron.in?subject=Grievance">hello@fitron.in</a> with the subject &quot;Grievance&quot;, or WhatsApp <a href="https://wa.me/916207774673">+91 62077 74673</a>. We acknowledge within 24 hours and resolve within 15 days.</p>
      </section>
      <section>
        <h2 id="changes">Changes</h2>
        <p>If we change this policy in a way that matters, we will tell you by email or in the app before the change takes effect.</p>
      </section>
    </LegalPage>
  );
}
