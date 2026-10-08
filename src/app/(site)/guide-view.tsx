import { GUIDES, GUIDES_PATH, guidePath, type Guide } from "@/lib/domain/guides";
import { TRIAL_DAYS } from "@/lib/domain/pricing";
import { gymSignupHref } from "@/lib/domain/site-links";
import { absoluteUrl, breadcrumbJsonLd, faqJsonLd, jsonLdScript, SITE_NAME } from "@/lib/seo";

// One guide for gym owners (content in src/lib/domain/guides.ts), shown by guides/[slug]/page.tsx. Plain <a> links, like
// the rest of the public pages.

const btn = "inline-flex items-center justify-center rounded-md px-5 py-3 text-sm leading-[1.2] font-semibold transition-colors";
const primary = `${btn} border border-transparent bg-accent text-accent-ink hover:bg-accent-hover`;
const secondary = `${btn} border border-line text-fg hover:bg-fg/7`;

export function guideJsonLd(g: Guide) {
  const url = absoluteUrl(guidePath(g));
  return [
    breadcrumbJsonLd([
      ["FITRON", "/"],
      ["Guides", GUIDES_PATH],
      [g.label, guidePath(g)],
    ]),
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: g.h1,
      description: g.description,
      url,
      mainEntityOfPage: url,
      inLanguage: "en-IN",
      datePublished: g.published,
      author: { "@id": absoluteUrl("/#org") },
      publisher: { "@id": absoluteUrl("/#org") },
      image: absoluteUrl("/site/og.png"),
    },
    faqJsonLd(g.faq),
  ];
}

export function GuideView({ guide: g }: { guide: Guide }) {
  const others = GUIDES.filter((x) => x.slug !== g.slug);
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
          <li>
            <a href={GUIDES_PATH} className="hover:text-fg">
              Guides
            </a>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{g.label}</li>
        </ol>
      </nav>

      <header className="mt-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">FITRON Guides</p>
        <h1 className="mt-3 text-4xl leading-tight font-semibold sm:text-5xl">{g.h1}</h1>
        <p className="mt-5 text-lg text-muted">{g.intro}</p>
        <nav aria-label="On this page" className="mt-6 rounded-lg border border-line p-4 text-sm">
          <p className="font-semibold">On this page</p>
          <ol className="mt-2 list-decimal pl-5 text-muted">
            {g.sections.map((s) => (
              <li key={s.id} className="mt-1">
                <a href={`#${s.id}`} className="hover:text-fg">
                  {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <div className="mt-10 flex flex-col gap-10 leading-relaxed">
        {g.sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-6">
            <h2 className="text-2xl font-semibold">{s.heading}</h2>
            {s.body.map((p) => (
              <p key={p} className="mt-3 text-muted">
                {p}
              </p>
            ))}
            {s.points && (
              <ul className="mt-3 list-disc pl-6 text-muted">
                {s.points.map((x) => (
                  <li key={x} className="mt-1.5">
                    {x}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}

        <section id="faq" className="scroll-mt-6">
          <h2 className="text-2xl font-semibold">Questions</h2>
          <div className="mt-4 flex flex-col divide-y divide-line border-y border-line">
            {g.faq.map((f) => (
              <details key={f.q} className="py-3">
                <summary className="cursor-pointer font-semibold">{f.q}</summary>
                <p className="mt-2 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-line p-6">
          <h2 className="text-2xl font-semibold">Do this in FITRON</h2>
          <p className="mt-2 text-muted">
            <a href={g.product[1]} className="font-semibold text-accent underline">
              {g.product[0]}
            </a>{" "}
            for gyms in India. The {TRIAL_DAYS}-day trial needs no card.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={gymSignupHref({ plan: "professional" })} className={primary}>
              Start your {TRIAL_DAYS}-day free trial
            </a>
            <a href={g.product[1]} className={secondary}>
              See how it works
            </a>
          </div>
        </section>

        <section id="more" className="scroll-mt-6">
          <h2 className="text-2xl font-semibold">More guides</h2>
          <ul className="mt-3 list-disc pl-6">
            {others.map((x) => (
              <li key={x.slug} className="mt-1.5">
                <a href={guidePath(x)} className="font-semibold text-accent underline">
                  {x.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(guideJsonLd(g)) }} />
    </article>
  );
}
