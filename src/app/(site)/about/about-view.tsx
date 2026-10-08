import Link from "next/link";
import { ABOUT, type AboutData } from "@/lib/domain/about";
import { lowestGymPrice, rupeesLabel, TRIAL_DAYS, findPlan } from "@/lib/domain/pricing";
import { publicCompany } from "@/lib/company";
import { absoluteUrl, breadcrumbJsonLd, jsonLdScript, SITE_NAME } from "@/lib/seo";

const card = "s-card p-5 sm:p-6";

/**
 * Everything on this page is something the product and the policies already say. The founder, customer and social sections
 * appear only when src/lib/domain/about-data.json has real entries; with none, the page simply has no such section.
 */
export function AboutView({ data = ABOUT }: { data?: AboutData }) {
  const company = publicCompany();
  const pro = findPlan("ai-pro")!;
  const graph: object[] = [
    breadcrumbJsonLd([
      ["FITRON", "/"],
      ["About", "/about"],
    ]),
    { "@type": "AboutPage", "@id": absoluteUrl("/about#page"), url: absoluteUrl("/about"), name: "About FITRON", about: { "@id": absoluteUrl("/#org") } },
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <a href="/" className="hover:text-fg">
              {SITE_NAME}
            </a>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">About</li>
        </ol>
      </nav>
      <h1 className="mt-5 text-4xl sm:text-5xl">About FITRON</h1>
      <p className="mt-4 text-lg text-muted">
        FITRON is a fitness technology platform built for India. One part is for the person training, one is for the gym they train in, and a partnership connects the two.
      </p>

      <section aria-labelledby="builds" className="mt-12">
        <h2 id="builds" className="text-2xl font-semibold">
          What we build
        </h2>
        <div className="mt-5 grid gap-4">
          <article className={card}>
            <h3 className="text-lg font-semibold">FITRON AI Trainer</h3>
            <p className="mt-2 text-muted">
              An AI personal trainer for individuals: a workout plan built around your goal and your equipment, Indian meal plans by city, diet and budget, and an AI coach to talk to every day. From {rupeesLabel(pro.price.MONTHLY)} a month, with a {TRIAL_DAYS}-day free trial.
            </p>
            <p className="mt-3">
              <a href="/ai-personal-trainer" className="font-semibold text-accent underline">
                About the AI Trainer
              </a>
            </p>
          </article>
          <article className={card}>
            <h3 className="text-lg font-semibold">FITRON Gym Accounting</h3>
            <p className="mt-2 text-muted">
              Members, fees, GST invoices, expenses, payments and profit and loss for Indian gyms, in one console, for one gym or every branch. From {rupeesLabel(lowestGymPrice("MONTHLY"))} a month, with a {TRIAL_DAYS}-day free trial.
            </p>
            <p className="mt-3">
              <a href="/gym-accounting" className="font-semibold text-accent underline">
                About Gym Accounting
              </a>
            </p>
          </article>
          <article className={card}>
            <h3 className="text-lg font-semibold">Gym Partnership</h3>
            <p className="mt-2 text-muted">A gym can offer the AI Trainer to its members and earn 70% of the eligible subscriptions its members take, under the partnership terms.</p>
            <p className="mt-3">
              <a href="/#partnership" className="font-semibold text-accent underline">
                About the partnership
              </a>
            </p>
          </article>
        </div>
      </section>

      <section aria-labelledby="care" className="mt-12">
        <h2 id="care" className="text-2xl font-semibold">
          How we treat your data
        </h2>
        <ul className="mt-3 list-disc pl-6 text-muted">
          <li className="mt-1.5">FITRON follows India&apos;s Digital Personal Data Protection Act, 2023. The data we store is hosted in India, and you can export or delete it.</li>
          <li className="mt-1.5">A member&apos;s conversations with the AI coach are never shown to their gym.</li>
          <li className="mt-1.5">The AI replies are written by an AI provider that may process them outside India. The privacy policy says exactly what is sent.</li>
          <li className="mt-1.5">The AI Trainer gives general fitness guidance, not medical advice.</li>
        </ul>
        <p className="mt-3">
          <Link href="/privacy" className="font-semibold text-accent underline">
            Read the Privacy Policy
          </Link>
        </p>
      </section>

      {data.founders.length > 0 && (
        <section aria-labelledby="people" className="mt-12">
          <h2 id="people" className="text-2xl font-semibold">
            Who is behind FITRON
          </h2>
          <div className="mt-5 grid gap-4">
            {data.founders.map((f) => (
              <article key={f.name} className={card}>
                <h3 className="text-lg font-semibold">{f.name}</h3>
                <p className="text-sm text-muted">{f.role}</p>
                <p className="mt-3 text-muted">{f.bio}</p>
                {f.url && (
                  <p className="mt-3">
                    <a href={f.url} rel="me noopener" className="font-semibold text-accent underline">
                      {f.name} online
                    </a>
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {data.stories.length > 0 && (
        <section aria-labelledby="stories" className="mt-12">
          <h2 id="stories" className="text-2xl font-semibold">
            What customers say
          </h2>
          <div className="mt-5 grid gap-4">
            {data.stories.map((x) => (
              <figure key={x.name + x.quote} className={card}>
                <blockquote className="text-lg">&ldquo;{x.quote}&rdquo;</blockquote>
                <figcaption className="mt-3 text-sm text-muted">
                  {x.name}
                  {[x.role, x.gym, x.city].filter(Boolean).length > 0 && `, ${[x.role, x.gym, x.city].filter(Boolean).join(", ")}`}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="contact" className="mt-12">
        <h2 id="contact" className="text-2xl font-semibold">
          Company details and contact
        </h2>
        {company && (
          <dl className="mt-3 flex flex-col gap-1 text-muted">
            <div>
              <dt className="inline font-semibold text-fg">Business: </dt>
              <dd className="inline">{company.name}</dd>
            </div>
            {company.address && (
              <div>
                <dt className="inline font-semibold text-fg">Registered address: </dt>
                <dd className="inline">{company.address}</dd>
              </div>
            )}
            {company.gstin && (
              <div>
                <dt className="inline font-semibold text-fg">GSTIN: </dt>
                <dd className="inline">{company.gstin}</dd>
              </div>
            )}
          </dl>
        )}
        <p className="mt-3 text-muted">
          Questions, demos, partnerships or account help: WhatsApp{" "}
          <a href="https://wa.me/916207774673" target="_blank" rel="noopener" data-track="whatsapp_click" data-track-from="about" className="font-semibold text-accent underline">
            +91 62077 74673
          </a>
          , email{" "}
          <a href="mailto:hello@fitron.in" data-track="email_click" data-track-from="about" className="font-semibold text-accent underline">
            hello@fitron.in
          </a>
          , Monday to Saturday, 10 am to 6 pm IST, or use the{" "}
          <Link href="/contact" className="font-semibold text-accent underline">
            contact form
          </Link>
          . Complaints about how your data is handled go to the{" "}
          <Link href="/privacy#grievance" className="font-semibold text-accent underline">
            Grievance Officer
          </Link>
          .
        </p>
        <p className="mt-3 text-sm text-muted">
          Our rules are in plain words: <Link href="/terms" className="underline">Terms &amp; Conditions</Link>, <Link href="/refund" className="underline">Refund Policy</Link> and the <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </section>

      {data.social.length > 0 && (
        <section aria-labelledby="follow" className="mt-12">
          <h2 id="follow" className="text-2xl font-semibold">
            Follow FITRON
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {data.social.map((x) => (
              <li key={x.url}>
                <a href={x.url} rel="me noopener" target="_blank" className="inline-block rounded-full border border-line px-3 py-1 text-sm text-muted no-underline hover:border-accent hover:text-fg">
                  {x.network}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
    </div>
  );
}

