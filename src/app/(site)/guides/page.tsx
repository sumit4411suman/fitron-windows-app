import Link from "next/link";
import { GUIDES, GUIDES_PATH, guidePath } from "@/lib/domain/guides";
import { absoluteUrl, breadcrumbJsonLd, jsonLdScript, pageMetadata, SITE_NAME } from "@/lib/seo";

// The list of guides for gym owners (content in src/lib/domain/guides.ts).

const title = "Gym Accounting Guides for Gym Owners in India | FITRON";
const description = "Plain guides for gym owners in India: managing a gym's accounts, GST on membership fees, profit and loss, and moving from a fee register to software.";

export const metadata = pageMetadata({ title, description, path: GUIDES_PATH });

export default function Page() {
  const graph = [
    breadcrumbJsonLd([
      ["FITRON", "/"],
      ["Guides", GUIDES_PATH],
    ]),
    {
      "@type": "CollectionPage",
      "@id": absoluteUrl(`${GUIDES_PATH}#page`),
      url: absoluteUrl(GUIDES_PATH),
      name: title,
      description,
      inLanguage: "en-IN",
      isPartOf: { "@id": absoluteUrl("/#website") },
      hasPart: GUIDES.map((g) => ({ "@id": absoluteUrl(`${guidePath(g)}#article`) })),
    },
  ];

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
          <li aria-current="page">Guides</li>
        </ol>
      </nav>
      <header className="mt-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">FITRON Guides</p>
        <h1 className="mt-3 text-4xl leading-tight font-semibold sm:text-5xl">Guides for gym owners</h1>
        <p className="mt-5 text-lg text-muted">How to keep a gym&apos;s accounts, charge GST, read your profit and loss, and move off the fee register. Written for gyms in India.</p>
        <p className="mt-3 text-muted">
          To try the numbers yourself, use the{" "}
          <Link href="/tools" className="font-semibold text-accent underline">
            free gym calculators
          </Link>
          .
        </p>
      </header>
      <ul className="mt-10 flex flex-col gap-4">
        {GUIDES.map((g) => (
          <li key={g.slug} className="rounded-lg border border-line p-5">
            <h2 className="text-xl font-semibold">
              <a href={guidePath(g)} className="hover:text-accent">
                {g.h1}
              </a>
            </h2>
            <p className="mt-2 text-muted">{g.description}</p>
          </li>
        ))}
      </ul>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
    </article>
  );
}
