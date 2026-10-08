import Link from "next/link";
import { TOOLS, TOOLS_PATH, toolPath } from "@/lib/domain/tools";
import { absoluteUrl, breadcrumbJsonLd, jsonLdScript, pageMetadata, SITE_NAME } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Free Gym and Fitness Calculators for India | FITRON",
  description: "Free calculators for gym owners (profit, break-even, GST, churn, pricing) and for members (protein and calories). No sign-up, built for Indian gyms.",
  path: TOOLS_PATH,
});

const group = (audience: "gym" | "fitness") => TOOLS.filter((t) => t.audience === audience);

function Cards({ list }: { list: typeof TOOLS }) {
  return (
    <ul className="mt-5 grid gap-4 sm:grid-cols-2">
      {list.map((t) => (
        <li key={t.slug}>
          <a href={toolPath(t)} className="s-card block h-full p-5 no-underline hover:border-accent">
            <h3 className="text-lg font-semibold">{t.label}</h3>
            <p className="mt-2 text-sm text-muted">{t.intro}</p>
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function ToolsPage() {
  const graph = [
    breadcrumbJsonLd([
      ["FITRON", "/"],
      ["Free tools", TOOLS_PATH],
    ]),
    { "@type": "ItemList", itemListElement: TOOLS.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.label, url: absoluteUrl(toolPath(t)) })) },
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
          <li aria-current="page">Free tools</li>
        </ol>
      </nav>
      <h1 className="mt-5 text-4xl sm:text-5xl">Free gym and fitness calculators</h1>
      <p className="mt-4 text-lg text-muted">Plain calculators for gym owners and for people who train. No sign-up, nothing is saved, and each page says how the answer is worked out.</p>

      <section aria-labelledby="gym-tools" className="mt-12">
        <h2 id="gym-tools" className="text-2xl font-semibold">
          For gym owners
        </h2>
        <Cards list={group("gym")} />
        <p className="mt-5 text-muted">
          The same numbers, kept for you every day: see{" "}
          <a href="/gym-accounting" className="font-semibold text-accent underline">
            FITRON Gym Accounting
          </a>{" "}
          or read the{" "}
          <Link href="/guides" className="font-semibold text-accent underline">
            guides for gym owners
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="fitness-tools" className="mt-12">
        <h2 id="fitness-tools" className="text-2xl font-semibold">
          For people who train
        </h2>
        <Cards list={group("fitness")} />
        <p className="mt-5 text-muted">
          Want a plan built around the answer? Try the{" "}
          <a href="/ai-personal-trainer" className="font-semibold text-accent underline">
            FITRON AI Trainer
          </a>
          , which also builds your workouts and Indian meal plans.
        </p>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
    </div>
  );
}
