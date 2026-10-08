import Link from "next/link";
import { GYM_PAGES } from "@/lib/domain/gym-pages";
import { rupeesLabel, TRIAL_DAYS } from "@/lib/domain/pricing";
import { trainerHref } from "@/lib/domain/site-links";
import { APP_FACTS, DATA_SAFETY, SCREENSHOTS, TRAINER_PAGE as page, TRAINER_PLAN_LIST } from "@/lib/domain/trainer-page";
import { absoluteUrl, breadcrumbJsonLd, faqJsonLd, jsonLdScript, pageMetadata, SITE_NAME } from "@/lib/seo";
import { LiveDemo } from "../live-demo";
import { ScreenshotGallery } from "./screenshot-gallery";

// The public page about the FITRON AI Trainer (content in src/lib/domain/trainer-page.ts), laid out like an app store
// listing: the app's icon, name and key facts with the free-trial button, a row of real screenshots (public/site/trainer,
// from scripts/trainer-screenshots.mjs), the whole app as a live demo (public/site/coach-demo.html#home, the same file as the
// home page's AI Coach demo), then what it does, data safety, plans, questions and app info.

const primary = "s-btn s-btn-primary";
const secondary = "s-btn s-btn-ghost";

export const metadata = pageMetadata({ title: page.title, description: page.description, path: page.path });

export default function Page() {
  const graph: object[] = [
    breadcrumbJsonLd([
      ["FITRON", "/"],
      [page.label, page.path],
    ]),
    faqJsonLd(page.faq),
    {
      "@type": "SoftwareApplication",
      "@id": absoluteUrl(`${page.path}#software`),
      name: "FITRON AI Trainer",
      url: absoluteUrl(page.path),
      applicationCategory: "HealthApplication",
      operatingSystem: "Web",
      description: page.description,
      publisher: { "@id": absoluteUrl("/#org") },
      offers: TRAINER_PLAN_LIST.map((p) => ({
        "@type": "Offer",
        name: p.name,
        price: p.price.MONTHLY / 100,
        priceCurrency: "INR",
        priceSpecification: { "@type": "UnitPriceSpecification", price: p.price.MONTHLY / 100, priceCurrency: "INR", billingDuration: 1, unitCode: "MON", valueAddedTaxIncluded: true },
      })),
    },
  ];

  const appInfo: [string, React.ReactNode][] = [
    ["Developer", "FITRON, India"],
    ["Category", "Health & fitness"],
    ["Price", `${TRIAL_DAYS}-day free trial, then from ${rupeesLabel(TRAINER_PLAN_LIST[0]!.price.MONTHLY)} a month (GST included)`],
    ["Works on", "Any modern phone or computer browser: Android, iPhone, Windows and Mac"],
    ["Content", "Fitness, nutrition and recovery guidance. General guidance, not medical advice."],
    [
      "Support",
      <a key="c" href="/contact" className="font-semibold text-accent underline">
        Contact FITRON
      </a>,
    ],
  ];
  const privacy = page.blocks.find((b) => b.id === "privacy")!;
  const shot = (id: string) => SCREENSHOTS.find((s) => s.id === id)!;

  return (
    <article className="mx-auto max-w-6xl">
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

      {/* The app header, laid out like an app store listing: icon, name, maker, the facts that matter, and the install button. */}
      <header className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static icon, already sized */}
        <img src="/site/trainer/icon.webp" width={256} height={256} alt="" className="size-20 shrink-0 rounded-[1.4rem] border border-line bg-white shadow-lg sm:size-28 sm:rounded-[1.8rem]" />
        <div className="min-w-0 flex-1">
          <p className="text-3xl leading-tight font-semibold sm:text-5xl">{page.appName}</p>
          <p className="mt-2 text-sm">
            <a href="/about" className="font-semibold text-accent hover:underline">
              FITRON
            </a>
            <span className="text-muted"> · Health &amp; fitness · Built for India</span>
          </p>
          <dl className="mt-5 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-center sm:grid-cols-4">
            {APP_FACTS.map(([k, v]) => (
              <div key={k} className="bg-bg px-3 py-2.5">
                <dt className="text-[11px] tracking-wider text-muted uppercase">{k}</dt>
                <dd className="mt-0.5 text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={trainerHref("ai-pro")} className={`${primary} min-w-48 justify-center`} data-track="start_ai_trial" data-track-from="ai-trainer-page">
              Start your {TRIAL_DAYS}-day free trial
            </a>
            <a href="#demo" className={secondary}>
              Try the live demo
            </a>
          </div>
          <p className="mt-3 text-sm text-muted">No card needed. Cancel any time. Opens in your phone or computer browser, nothing to download.</p>
        </div>
      </header>

      <section id="screenshots" aria-label="Screenshots" className="mt-10 scroll-mt-28">
        <ScreenshotGallery shots={SCREENSHOTS} />
      </section>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* The live demo: beside the text on a computer (and staying in view), straight after the screenshots on a phone. */}
        <aside id="demo" className="scroll-mt-28 lg:col-start-2 lg:row-start-1">
          <div className="lg:sticky lg:top-24">
            <h2 className="text-2xl font-semibold">Try the app</h2>
            <p className="mt-2 text-sm text-muted">The real AI Trainer, signed in as a sample member. Open any tab: workouts, meals, the coach, habits, progress.</p>
            {/* Lazy: the picture is about 50 KB and the demo itself (3 MB) loads only when it is played. */}
            <figure className="mx-auto mt-4 w-[min(320px,100%)]">
              <div className="overflow-hidden rounded-[2rem] border border-line">
                <LiveDemo
                  kind="app"
                  poster="/site/trainer/home.webp"
                  width={540}
                  height={1169}
                  alt="FITRON AI Trainer home screen on a phone: today's workout, streak, water and steps, with tabs for workouts, the AI coach and progress"
                />
              </div>
              <figcaption className="mt-3 text-center text-sm text-muted">A sample member, not your data. General guidance, not medical advice.</figcaption>
            </figure>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-12 leading-relaxed lg:col-start-1 lg:row-start-1">
          <section id="about" className="scroll-mt-28">
            <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">About this app</p>
            <h1 className="mt-3 text-3xl leading-tight font-semibold sm:text-4xl">{page.h1}</h1>
            <p className="mt-4 text-lg text-muted">{page.intro}</p>
            <ul className="mt-5 flex flex-wrap gap-2" aria-label="What it does">
              {page.blocks
                .filter((b) => "shot" in b)
                .map((b) => (
                  <li key={b.id}>
                    <a href={`#${b.id}`} className="inline-flex rounded-full border border-line px-3 py-1 text-sm hover:border-accent">
                      {b.heading}
                    </a>
                  </li>
                ))}
            </ul>
          </section>

          {page.blocks
            .filter((b) => b.id !== "privacy")
            .map((b) => {
              const pic = "shot" in b && b.shot ? shot(b.shot) : null;
              return (
                <section key={b.id} id={b.id} className={`scroll-mt-28 ${pic ? "grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_170px]" : ""}`}>
                  <div>
                    <h2 className="text-2xl font-semibold">{b.heading}</h2>
                    <p className="mt-3 text-muted">{b.body}</p>
                    {"points" in b && b.points && (
                      <ul className="mt-3 list-disc pl-6 text-muted">
                        {b.points.map((x) => (
                          <li key={x} className="mt-1.5">
                            {x}
                          </li>
                        ))}
                      </ul>
                    )}
                    {"link" in b && b.link && (
                      <p className="mt-3">
                        <a href={b.link[1]} className="font-semibold text-accent underline">
                          {b.link[0]}
                        </a>
                      </p>
                    )}
                  </div>
                  {pic && (
                    // eslint-disable-next-line @next/next/no-img-element -- the same static screenshot as in the gallery
                    <img
                      src={`/site/trainer/${pic.id}.webp`}
                      width={540}
                      height={1169}
                      alt={pic.alt}
                      loading="lazy"
                      decoding="async"
                      className="mx-auto block h-auto w-[170px] rounded-2xl border border-line max-sm:w-[60%]"
                    />
                  )}
                </section>
              );
            })}

          {/* Like a store's data safety section, from the privacy block and the privacy policy. */}
          <section id="privacy" className="scroll-mt-28">
            <h2 className="text-2xl font-semibold">Data safety</h2>
            <p className="mt-3 text-muted">{privacy.body}</p>
            <ul className="s-card mt-5 grid gap-5 p-5 sm:grid-cols-2">
              {DATA_SAFETY.map(([k, v]) => (
                <li key={k} className="flex gap-3">
                  <svg viewBox="0 0 24 24" className="mt-0.5 size-5 shrink-0 fill-none stroke-accent stroke-2" aria-hidden="true">
                    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                  <span>
                    <span className="block font-semibold">{k}</span>
                    <span className="mt-0.5 block text-sm text-muted">{v}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3">
              <a href="/privacy" className="font-semibold text-accent underline">
                Read the privacy policy
              </a>
            </p>
          </section>

          <section id="plans" className="scroll-mt-28">
            <h2 className="text-2xl font-semibold">Plans and pricing</h2>
            <p className="mt-3 text-muted">Both plans start with a {TRIAL_DAYS}-day free trial. Prices include GST; yearly plans are billed upfront.</p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2">
              {TRAINER_PLAN_LIST.map((p) => (
                <li key={p.key} className="rounded-lg border border-line p-4">
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="mt-1 text-2xl font-semibold">
                    {rupeesLabel(p.price.MONTHLY)}
                    <span className="text-sm font-normal text-muted"> / month</span>
                  </p>
                  <p className="mt-2 text-sm text-muted">or {rupeesLabel(p.price.YEARLY)} a year</p>
                  <p className="mt-1 text-sm text-muted">{p.tagline}</p>
                </li>
              ))}
            </ul>
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

          <section id="app-info" className="scroll-mt-28">
            <h2 className="text-2xl font-semibold">App info</h2>
            <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
              {appInfo.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-4 py-2.5">
                  <dt className="text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="tools" className="scroll-mt-28">
            <h2 className="text-2xl font-semibold">Free calculators</h2>
            <p className="mt-3 text-muted">
              Not ready to start? Work out your daily protein with the{" "}
              <Link href="/tools/protein-calculator" className="font-semibold text-accent underline">
                protein calculator
              </Link>{" "}
              or your calories with the{" "}
              <Link href="/tools/calorie-calculator" className="font-semibold text-accent underline">
                calorie calculator
              </Link>
              . Both are free and need no sign-up.
            </p>
          </section>

          <section id="more" className="scroll-mt-28">
            <h2 className="text-2xl font-semibold">Run a gym?</h2>
            <p className="mt-3 text-muted">
              Give the AI Trainer to your members and earn 70% of every eligible subscription, subject to the partnership terms.{" "}
              <a href="/#partnership" className="font-semibold text-accent underline">
                See the gym partnership
              </a>{" "}
              or{" "}
              <a href="/#pricing" className="font-semibold text-accent underline">
                compare all plans
              </a>
              .
            </p>
            <ul className="mt-3 list-disc pl-6">
              {GYM_PAGES.map((p) => (
                <li key={p.path} className="mt-1.5">
                  <a href={p.path} className="font-semibold text-accent underline">
                    {p.label}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className="s-card p-6">
            <h2 className="text-2xl font-semibold">Start your {TRIAL_DAYS}-day free trial.</h2>
            <p className="mt-2 text-muted">
              Tell FITRON your goal and the equipment you have, and your plan is built around it. The trial needs no card, and a paid plan starts only when you choose it.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a href={trainerHref("ai-pro")} className={primary} data-track="start_ai_trial" data-track-from="ai-trainer-page">
                Start your {TRIAL_DAYS}-day free trial
              </a>
            </div>
          </section>
        </div>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
    </article>
  );
}
