import Link from "next/link";
import Image from "next/image";
import { GUIDES, guidePath } from "@/lib/domain/guides";
import { GYM_ACCOUNTING, GYM_PAGES, planNote, type GymPage } from "@/lib/domain/gym-pages";
import { PLANS, TRIAL_DAYS, rupeesLabel } from "@/lib/domain/pricing";
import { gymSignupHref } from "@/lib/domain/site-links";
import { absoluteUrl, breadcrumbJsonLd, faqJsonLd, jsonLdScript, pageMetadata, SITE_NAME } from "@/lib/seo";
import { LiveDemo } from "./live-demo";

// One of the public pages about Gym Accounting (content in src/lib/domain/gym-pages.ts). Plain <a> links, like the rest of
// the public pages: the home page they point to is a static file, not a route.

const primary = "s-btn s-btn-primary";
const secondary = "s-btn s-btn-ghost";

export const gymPageMetadata = (p: GymPage) => pageMetadata({ title: p.title, description: p.description, path: p.path });

const gymPlans = PLANS.filter((p) => p.product === "GYM_ACCOUNTING");

export function GymPageView({ page }: { page: GymPage }) {
  const others = GYM_PAGES.filter((p) => p.path !== page.path);
  const graph: object[] = [
    breadcrumbJsonLd([
      ["FITRON", "/"],
      [page.label, page.path],
    ]),
    faqJsonLd(page.faq),
  ];
  if (page.path === GYM_ACCOUNTING.path) {
    graph.push({
      "@type": "SoftwareApplication",
      "@id": absoluteUrl(`${GYM_ACCOUNTING.path}#software`),
      name: "FITRON Gym Accounting",
      url: absoluteUrl(page.path),
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: page.description,
      publisher: { "@id": absoluteUrl("/#org") },
      offers: gymPlans.map((p) => ({
        "@type": "Offer",
        name: p.name,
        price: p.price.MONTHLY / 100,
        priceCurrency: "INR",
        priceSpecification: { "@type": "UnitPriceSpecification", price: p.price.MONTHLY / 100, priceCurrency: "INR", billingDuration: 1, unitCode: "MON", valueAddedTaxIncluded: true },
      })),
    });
  }

  return (
    <article className="mx-auto max-w-3xl">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <a href="/" className="hover:text-fg">
              {SITE_NAME}
            </a>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{page.label}</li>
        </ol>
      </nav>

      <header className="mt-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">{page.kicker}</p>
        <h1 className="mt-3 text-4xl leading-tight font-semibold sm:text-5xl">{page.h1}</h1>
        <p className="mt-5 text-lg text-muted">{page.intro}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a href={gymSignupHref({ plan: "professional" })} className={primary} data-track="start_gym_trial" data-track-from="gym-page-hero">
            Start {TRIAL_DAYS}-Day Free Trial
          </a>
          <a href="/contact?topic=demo" className={secondary} data-track="demo_request" data-track-from="gym-page-hero">
            Book a Demo
          </a>
        </div>
        <p className="mt-3 text-sm text-muted">
          No card needed. See the{" "}
          <a href="/#pricing" className="underline">
            plans and pricing
          </a>
          , or WhatsApp us on +91 62077 74673.
        </p>
      </header>

      <nav aria-label="On this page" className="mt-10">
        <p className="s-eyebrow">What this page covers</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {page.blocks.map((b) => (
            <li key={b.id}>
              <a href={`#${b.id}`} className="inline-block rounded-full border border-line px-3 py-1 text-sm text-muted no-underline hover:border-accent hover:text-fg">
                {b.heading}
              </a>
            </li>
          ))}
          <li>
            <a href="#plans" className="inline-block rounded-full border border-line px-3 py-1 text-sm text-muted no-underline hover:border-accent hover:text-fg">
              Plans and pricing
            </a>
          </li>
        </ul>
      </nav>

      {/* Below the first screen on a phone, and lazy: the picture is 54 KB and would otherwise load ahead of the page's own text. */}
      {page.path === GYM_ACCOUNTING.path && (
        <figure className="mt-10 overflow-hidden rounded-lg border border-line">
          <LiveDemo
            poster="/site/console-dashboard.webp"
            srcSet="/site/console-dashboard-700.webp 700w, /site/console-dashboard.webp 1400w"
            width={1400}
            height={658}
            alt="FITRON Gym Accounting dashboard showing active members, revenue, outstanding dues and renewals for a gym"
          />
          <figcaption className="px-4 py-2 text-sm text-muted">The Gym Accounting dashboard: members, revenue, dues and renewals at a glance. Try the live demo to click around it.</figcaption>
        </figure>
      )}

      <p className="mt-6 text-sm text-muted">The screenshots on this page are from FITRON&apos;s demo gym, with sample members and numbers.</p>

      <div className="mt-8 flex flex-col gap-10 leading-relaxed">
        {page.blocks.map((b) => (
          <section key={b.id} id={b.id} className="scroll-mt-28">
            <h2 className="text-2xl font-semibold">{b.heading}</h2>
            {b.feature && <p className="mt-2 inline-block rounded-full border border-line px-3 py-0.5 text-xs font-semibold text-muted">{planNote(b.feature)}</p>}
            <p className="mt-3 text-muted">{b.body}</p>
            {b.points && (
              <ul className="mt-3 list-disc pl-6 text-muted">
                {b.points.map((x) => (
                  <li key={x} className="mt-1.5">
                    {x}
                  </li>
                ))}
              </ul>
            )}
            {b.link && (
              <p className="mt-3">
                <a href={b.link[1]} className="font-semibold text-accent underline">
                  {b.link[0]}
                </a>
              </p>
            )}
            {b.shots && (
              <div className="mt-5 grid gap-4">
                {b.shots.map((x) => (
                  <figure key={x.src} className="overflow-hidden rounded-xl border border-line">
                    <Image src={x.src} alt={x.alt} width={x.width} height={x.height} sizes="(min-width: 768px) 768px, 100vw" loading="lazy" fetchPriority="low" unoptimized className="h-auto w-full" />
                  </figure>
                ))}
              </div>
            )}
          </section>
        ))}

        <section id="plans" className="scroll-mt-28">
          <h2 className="text-2xl font-semibold">Plans and pricing</h2>
          <p className="mt-3 text-muted">Every plan starts with a {TRIAL_DAYS}-day free trial. Prices are per month, GST included; yearly plans are billed upfront.</p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-3">
            {gymPlans.map((p) => (
              <li key={p.key} className={`rounded-lg border p-4 ${p.key === "professional" ? "border-accent" : "border-line"}`}>
                <h3 className="font-semibold">
                  {p.name}
                  {p.key === "professional" && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-xs font-bold text-accent-ink">Recommended</span>}
                </h3>
                <p className="mt-1 text-2xl font-semibold">
                  {rupeesLabel(p.price.MONTHLY)}
                  <span className="text-sm font-normal text-muted"> / month</span>
                </p>
                <p className="mt-2 text-sm text-muted">{p.card?.limit}</p>
                <p className="mt-1 text-sm text-muted">{p.card?.audience}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            <a href="/#pricing" className="font-semibold text-accent underline">
              Compare everything each plan includes
            </a>
          </p>
        </section>

        <section id="faq" className="scroll-mt-28">
          <h2 className="text-2xl font-semibold">Questions</h2>
          <div className="mt-4 flex flex-col divide-y divide-line border-y border-line">
            {page.faq.map((f) => (
              <details key={f.q} className="py-3">
                <summary className="cursor-pointer font-semibold">{f.q}</summary>
                <p className="mt-2 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="more" className="scroll-mt-28">
          <h2 className="text-2xl font-semibold">Keep reading</h2>
          <ul className="mt-3 list-disc pl-6">
            {others.map((p) => (
              <li key={p.path} className="mt-1.5">
                <a href={p.path} className="font-semibold text-accent underline">
                  {p.label}
                </a>
              </li>
            ))}
            {GUIDES.map((g) => (
              <li key={g.slug} className="mt-1.5">
                <a href={guidePath(g)} className="font-semibold text-accent underline">
                  Guide: {g.label}
                </a>
              </li>
            ))}
            <li className="mt-1.5">
              <Link href="/tools" className="font-semibold text-accent underline">
                Free calculators: gym profit, break-even, GST and churn
              </Link>
            </li>
            <li className="mt-1.5">
              <a href="/ai-personal-trainer" className="font-semibold text-accent underline">
                The FITRON AI Trainer, for your members
              </a>
            </li>
          </ul>
        </section>

        <section className="s-card p-6">
          <h2 className="text-3xl">Run your gym without the spreadsheet chaos.</h2>
          <p className="mt-2 text-muted">Open an account, add a few members and make one invoice. If it is not for you, nothing is charged: the trial needs no card, and a paid plan starts only when you choose it.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={gymSignupHref({ plan: "professional" })} className={primary} data-track="start_gym_trial" data-track-from="gym-page-footer">
              Start {TRIAL_DAYS}-Day Free Trial
            </a>
            <a href="/contact?topic=demo" className={secondary} data-track="demo_request" data-track-from="gym-page-footer">
              Book a Demo
            </a>
          </div>
        </section>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
    </article>
  );
}
