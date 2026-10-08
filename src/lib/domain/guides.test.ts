import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuideView } from "@/app/(site)/guide-view";
import GuidesIndex from "@/app/(site)/guides/page";
import { generateMetadata, generateStaticParams } from "@/app/(site)/guides/[slug]/page";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { isPublicPath } from "@/lib/public-paths";
import { GUIDES, GUIDES_PATH, guidePath } from "./guides";
import { GYM_PAGES } from "./gym-pages";

const root = path.join(__dirname, "../../..");
const home = readFileSync(path.join(root, "public/site/index.html"), "utf8");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
type Node = Record<string, unknown> & { "@type": string };
const graphOf = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!)["@graph"] as Node[];

describe.each(GUIDES.map((g) => [g.slug, g] as const))("guide %s", (_slug, g) => {
  const html = renderToStaticMarkup(createElement(GuideView, { guide: g }));

  it("has a title and description that fit a search result", () => {
    expect(g.title.length).toBeGreaterThanOrEqual(30);
    expect(g.title.length).toBeLessThanOrEqual(65);
    expect(g.description.length).toBeGreaterThanOrEqual(70);
    expect(g.description.length).toBeLessThanOrEqual(160);
    expect(g.title.endsWith("| FITRON")).toBe(true);
  });

  it("is indexable at its own address, as an article", async () => {
    const m = await generateMetadata({ params: Promise.resolve({ slug: g.slug }) } as never);
    expect(m.alternates?.canonical).toBe(`https://fitron.in${guidePath(g)}`);
    expect(m.robots).toMatchObject({ index: true, follow: true });
    expect(m.openGraph).toMatchObject({ type: "article", url: `https://fitron.in${guidePath(g)}` });
  });

  it("has one main heading and a linkable id on every section", () => {
    expect([...html.matchAll(/<h1[ >]/g)]).toHaveLength(1);
    expect(decode(html.match(/<h1[^>]*>(.*?)<\/h1>/)![1]!)).toBe(g.h1);
    const ids = g.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(html.includes(`id="${id}"`), id).toBe(true);
  });

  it("describes itself as an article and repeats exactly the questions a visitor can read", () => {
    const graph = graphOf(html);
    expect(graph.find((n) => n["@type"] === "Article")).toMatchObject({ headline: g.h1, datePublished: g.published });
    const faq = graph.find((n) => n["@type"] === "FAQPage") as unknown as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    const shown = [...html.matchAll(/<summary[^>]*>(.*?)<\/summary><p[^>]*>(.*?)<\/p>/g)].map((m) => [decode(m[1]!), decode(m[2]!)]);
    expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(shown);
    expect(shown).toEqual(g.faq.map((f) => [f.q, f.a]));
  });

  it("only links to pages that exist, and leads to a product page", () => {
    const known = new Set(["/", "/login", GUIDES_PATH, ...GUIDES.map(guidePath), ...GYM_PAGES.map((p) => p.path)]);
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => decode(m[1]!));
    const bad = links.filter((l) => !l.startsWith("#") && !known.has(l.split(/[?#]/)[0] || "/"));
    expect(bad).toEqual([]);
    expect(GYM_PAGES.some((p) => p.path === g.product[1])).toBe(true);
  });

  it("is listed in the sitemap and open to visitors", () => {
    expect(sitemap().map((s) => s.url)).toContain(`https://fitron.in${guidePath(g)}`);
    expect(isPublicPath(guidePath(g))).toBe(true);
  });
});

describe("the guides index", () => {
  const html = renderToStaticMarkup(createElement(GuidesIndex));

  it("links to every guide, is allowed in robots.txt and linked from the home page", () => {
    for (const g of GUIDES) expect(html.includes(`href="${guidePath(g)}"`), g.slug).toBe(true);
    expect(generateStaticParams()).toEqual(GUIDES.map((g) => ({ slug: g.slug })));
    expect((robots().rules as { allow: string[] }).allow).toContain(GUIDES_PATH);
    expect(sitemap().map((s) => s.url)).toContain(`https://fitron.in${GUIDES_PATH}`);
    expect(home.includes(`href="${GUIDES_PATH}"`)).toBe(true);
  });
});

describe("the guides after the console saves something", () => {
  // The console's server actions call revalidatePath("/", "layout"), which throws away every cached page. A page built ahead
  // of time with `dynamicParams = false` cannot be built again when asked for (Next answers NoFallbackError), so every guide
  // gave a 404 until the server restarted. CI only showed it late in the e2e run, in the sitemap test; this keeps it out.
  it("are not pages that refuse to be built again on request", () => {
    const app = path.join(root, "src/app");
    const files = (readdirSync(app, { recursive: true }) as string[]).filter((f) => /(^|[\\/])(page|layout)\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    const refusing = files.filter((f) => /^export const dynamicParams\s*=\s*false/m.test(readFileSync(path.join(app, f), "utf8")));
    expect(refusing).toEqual([]);
  });
});
