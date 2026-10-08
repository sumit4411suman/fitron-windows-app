import type { Metadata } from "next";

// What search engines and link previews are told about the public pages of fitron.in. The home page is a static file
// (public/site/index.html, built by scripts/site_patches.py) and carries its own copy of these tags.

export const SITE_URL = "https://fitron.in";
export const SITE_NAME = "FITRON";
export const SOCIAL_IMAGE = { url: `${SITE_URL}/site/og.png`, width: 1200, height: 630 };

export const absoluteUrl = (path: string) => `${SITE_URL}${path}`;

/** Title, description, canonical address and link preview for one public page. */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    // The root layout keeps every other page out of search results; the public pages say so explicitly.
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large", "max-video-preview": -1 } },
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_IN", url, title, description, images: [SOCIAL_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [SOCIAL_IMAGE.url] },
  };
}

export type Crumb = readonly [name: string, path: string];

export const breadcrumbJsonLd = (crumbs: readonly Crumb[]) => ({
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: absoluteUrl(path) })),
});

export const faqJsonLd = (faq: readonly { q: string; a: string }[]) => ({
  "@type": "FAQPage",
  mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
});

/** One <script type="application/ld+json"> body. A "<" is escaped so page text can never close the script early. */
export const jsonLdScript = (graph: readonly object[]) => JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
