import { notFound } from "next/navigation";
import { TOOLS, TOOLS_PATH, findTool, toolPath } from "@/lib/domain/tools";
import { TRIAL_DAYS } from "@/lib/domain/pricing";
import { absoluteUrl, breadcrumbJsonLd, jsonLdScript, pageMetadata, SITE_NAME } from "@/lib/seo";
import { Calculator } from "../calculators";

export const generateStaticParams = () => TOOLS.map((t) => ({ slug: t.slug }));

export async function generateMetadata({ params }: PageProps<"/tools/[slug]">) {
  const t = findTool((await params).slug);
  return t ? pageMetadata({ title: t.title, description: t.description, path: toolPath(t) }) : {};
}

export default async function ToolPage({ params }: PageProps<"/tools/[slug]">) {
  const t = findTool((await params).slug);
  if (!t) notFound();
  const others = TOOLS.filter((x) => x.slug !== t.slug && x.audience === t.audience);
  const graph = [
    breadcrumbJsonLd([
      ["FITRON", "/"],
      ["Free tools", TOOLS_PATH],
      [t.label, toolPath(t)],
    ]),
    {
      "@type": "WebApplication",
      "@id": absoluteUrl(`${toolPath(t)}#tool`),
      name: t.label,
      url: absoluteUrl(toolPath(t)),
      description: t.description,
      applicationCategory: t.audience === "gym" ? "BusinessApplication" : "HealthApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
      publisher: { "@id": absoluteUrl("/#org") },
    },
  ];
  return (
    <div className="mx-auto max-w-4xl">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <a href="/" className="hover:text-fg">
              {SITE_NAME}
            </a>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <a href={TOOLS_PATH} className="hover:text-fg">
              Free tools
            </a>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{t.label}</li>
        </ol>
      </nav>
      <h1 className="mt-5 text-4xl sm:text-5xl">{t.h1}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">{t.intro}</p>

      <div className="mt-8">
        <Calculator slug={t.slug} />
        <p className="mt-4 text-sm text-muted">{t.note}</p>
      </div>

      <section aria-labelledby="how" className="mt-12 max-w-3xl">
        <h2 id="how" className="text-2xl font-semibold">
          How it is worked out
        </h2>
        <ul className="mt-3 list-disc pl-6 text-muted">
          {t.method.map((m) => (
            <li key={m} className="mt-1.5">
              {m}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="faq" className="mt-12 max-w-3xl">
        <h2 id="faq" className="text-2xl font-semibold">
          Questions
        </h2>
        <div className="mt-4 flex flex-col divide-y divide-line border-y border-line">
          {t.faq.map((f) => (
            <details key={f.q} className="py-3">
              <summary className="cursor-pointer font-semibold">{f.q}</summary>
              <p className="mt-2 text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="s-card mt-12 flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold">{t.audience === "gym" ? "Stop re-typing these numbers" : "Make it a plan"}</h2>
          <p className="mt-1 text-muted">
            <a href={t.product[1]} className="font-semibold text-accent underline">
              {t.product[0]}
            </a>
            . Start with a {TRIAL_DAYS}-day free trial, no card needed.
          </p>
        </div>
        <a href={t.audience === "gym" ? "/signup?plan=professional" : "/signup?plan=ai-pro"} data-track={t.audience === "gym" ? "start_gym_trial" : "start_ai_trial"} data-track-from={`tool-${t.slug}`} className="s-btn s-btn-primary">
          Start free trial
        </a>
      </section>

      <section aria-labelledby="more-tools" className="mt-12">
        <h2 id="more-tools" className="text-xl font-semibold">
          More free tools
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {others.map((o) => (
            <li key={o.slug}>
              <a href={toolPath(o)} className="inline-block rounded-full border border-line px-3 py-1 text-sm text-muted no-underline hover:border-accent hover:text-fg">
                {o.label}
              </a>
            </li>
          ))}
          <li>
            <a href={TOOLS_PATH} className="inline-block rounded-full border border-line px-3 py-1 text-sm text-muted no-underline hover:border-accent hover:text-fg">
              All free tools
            </a>
          </li>
        </ul>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
    </div>
  );
}
