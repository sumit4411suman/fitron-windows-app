import { ContactForm } from "./contact-form";
import { publicCompany } from "@/lib/company";
import { pageMetadata } from "@/lib/seo";
import { TOPICS } from "@/lib/validation/site";

export const metadata = pageMetadata({
  title: "Contact FITRON | AI Fitness & Gym Management Software",
  description: "Contact FITRON for AI Trainer support, Gym Accounting demos, gym partnerships, billing questions and account assistance.",
  path: "/contact",
});

const way = "s-card flex flex-col gap-1 p-5 no-underline";

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const q = await searchParams;
  const topic = typeof q.topic === "string" && q.topic in TOPICS ? q.topic : "general";
  const company = publicCompany();
  const label = "s-eyebrow";
  return (
    <>
      <header className="max-w-2xl">
        <p className={label}>Contact</p>
        <h1 className="mt-3 text-4xl sm:text-5xl">Talk to FITRON</h1>
        <p className="mt-4 text-lg text-muted">Questions, product demos, partnerships or account support. We reply within one working day.</p>
      </header>

      <ul className="mt-10 grid gap-4 sm:grid-cols-3">
        <li>
          <a href="https://wa.me/916207774673" target="_blank" rel="noopener" data-track="whatsapp_click" data-track-from="contact" className={`${way} h-full hover:border-accent`}>
            <span className={label}>WhatsApp</span>
            <span className="text-lg font-semibold">+91 62077 74673</span>
            <span className="text-sm text-muted">The quickest way to reach us.</span>
          </a>
        </li>
        <li>
          <a href="mailto:hello@fitron.in" data-track="email_click" data-track-from="contact" className={`${way} h-full hover:border-accent`}>
            <span className={label}>Email</span>
            <span className="text-lg font-semibold">hello@fitron.in</span>
            <span className="text-sm text-muted">Billing, refunds and anything longer.</span>
          </a>
        </li>
        <li className={`${way} h-full`}>
          <span className={label}>Business hours</span>
          <span className="text-lg font-semibold">Monday to Saturday</span>
          <span className="text-sm text-muted">10 am to 6 pm IST</span>
        </li>
      </ul>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_minmax(0,34rem)]">
        <section aria-labelledby="company-heading">
          <h2 id="company-heading" className="text-2xl font-semibold">
            Company details
          </h2>
          <dl id="company" className="mt-5 flex scroll-mt-28 flex-col gap-4">
            {company ? (
              <>
                <div>
                  <dt className={label}>Business</dt>
                  <dd className="text-lg">{company.name}</dd>
                </div>
                {company.address && (
                  <div>
                    <dt className={label}>Registered address</dt>
                    <dd className="text-lg">{company.address}</dd>
                  </div>
                )}
                {company.gstin && (
                  <div>
                    <dt className={label}>GSTIN</dt>
                    <dd className="text-lg">{company.gstin}</dd>
                  </div>
                )}
              </>
            ) : (
              <div>
                <dt className={label}>Business</dt>
                <dd className="text-lg">FITRON</dd>
              </div>
            )}
          </dl>
          <p className="mt-8 text-muted">
            Running a gym and want FITRON for your members? See the{" "}
            <a href="/#partnership" className="font-semibold text-accent underline">
              gym partnership
            </a>{" "}
            and its{" "}
            <a href="/#pricing" className="font-semibold text-accent underline">
              plans
            </a>
            , or read about{" "}
            <a href="/gym-accounting" className="font-semibold text-accent underline">
              Gym Accounting
            </a>
            .
          </p>
        </section>
        <section aria-labelledby="form-heading" className="s-card p-5 sm:p-6">
          <h2 id="form-heading" className="mb-4 text-2xl font-semibold">
            Send us a message
          </h2>
          <ContactForm topic={topic} />
        </section>
      </div>

      <section className="s-card mt-14 flex flex-wrap items-center justify-between gap-4 p-6 sm:p-8">
        <div>
          <h2 className="text-3xl">Let&apos;s talk.</h2>
          <p className="mt-1 text-muted">Tell us about your gym, or ask for a demo of Gym Accounting.</p>
        </div>
        <a href="/contact?topic=demo#form-heading" data-track="demo_request" data-track-from="contact" className="s-btn s-btn-primary">
          Book a demo
        </a>
      </section>
    </>
  );
}
