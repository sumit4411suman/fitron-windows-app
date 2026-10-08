import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GymPageView, gymPageMetadata } from "@/app/(site)/gym-page";
import sitemap from "@/app/sitemap";
import { GUIDES, guidePath } from "./guides";
import { GYM_ACCOUNTING, GYM_PAGES } from "./gym-pages";
import { FEATURES, PLAN_FEATURES, planFor } from "./features";
import { PLANS } from "./pricing";

const root = path.join(__dirname, "../../..");
const home = readFileSync(path.join(root, "public/site/index.html"), "utf8");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (p: (typeof GYM_PAGES)[number]) => renderToStaticMarkup(createElement(GymPageView, { page: p }));
/** The structured data of a page, as plain data. */
type Node = Record<string, unknown> & { "@type": string };
const graphOf = (html: string) => {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "";
  return (JSON.parse(raw || "{}")["@graph"] ?? []) as Node[];
};

describe.each(GYM_PAGES.map((p) => [p.path, p] as const))("%s", (_path, page) => {
  const html = render(page);

  it("has a title and description that fit a search result", () => {
    expect(page.title.length).toBeGreaterThanOrEqual(30);
    expect(page.title.length).toBeLessThanOrEqual(65);
    expect(page.description.length).toBeGreaterThanOrEqual(70);
    expect(page.description.length).toBeLessThanOrEqual(160);
    expect(page.title.includes("FITRON"), "title names the brand").toBe(true);
  });

  it("tells search engines its one address, and shows a preview when shared", () => {
    const m = gymPageMetadata(page);
    expect(m.alternates?.canonical).toBe(`https://fitron.in${page.path}`);
    expect(m.openGraph).toMatchObject({ url: `https://fitron.in${page.path}`, title: page.title, description: page.description });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("has one main heading, and every section has an id the page can be linked to", () => {
    expect([...html.matchAll(/<h1[ >]/g)]).toHaveLength(1);
    expect(decode(html.match(/<h1[^>]*>(.*?)<\/h1>/)![1]!)).toBe(page.h1);
    const ids = page.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(html.includes(`id="${id}"`), id).toBe(true);
  });

  it("is listed in the sitemap, so search engines are told about it", () => {
    expect(sitemap().map((s) => s.url)).toContain(`https://fitron.in${page.path}`);
  });

  it("only links to pages and sections that exist", () => {
    const known = new Set(["/", "/login", "/contact", "/privacy", "/ai-personal-trainer", "/tools", "/site/gym-demo.html", "/site/coach-demo.html", "/site/partner-demo.html", ...GYM_PAGES.map((p) => p.path), ...GUIDES.map(guidePath)]);
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => decode(m[1]!));
    expect(links.length).toBeGreaterThan(8);
    const bad: string[] = [];
    for (const href of links) {
      const [p, hash] = href.split("#");
      const [pathOnly] = p!.split("?");
      if (!known.has(pathOnly || "/")) bad.push(href);
      if (hash && pathOnly === "/" && !home.includes(`id="${hash}"`)) bad.push(href);
    }
    expect(bad).toEqual([]);
  });

  it("says which plan opens each section that belongs to a plan, as the console does", () => {
    for (const b of page.blocks.filter((x) => x.feature)) {
      expect(html.includes(`Included from ${planFor(b.feature!).name}`), b.heading).toBe(true);
      // Starter opens none of the plan features, so a tagged section is never one that every gym has.
      expect(PLAN_FEATURES.starter!.includes(b.feature!), b.heading).toBe(false);
      expect(FEATURES[b.feature!], b.heading).toBeDefined();
    }
  });

  it("repeats exactly the questions and answers a visitor can read, in its structured data", () => {
    const faq = graphOf(html).find((g) => g["@type"] === "FAQPage") as unknown as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    const shown = [...html.matchAll(/<summary[^>]*>(.*?)<\/summary><p[^>]*>(.*?)<\/p>/g)].map((m) => [decode(m[1]!), decode(m[2]!)]);
    expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(shown);
    expect(shown).toEqual(page.faq.map((f) => [f.q, f.a]));
  });

  it("describes where it sits in the site", () => {
    const crumbs = graphOf(html).find((g) => g["@type"] === "BreadcrumbList") as unknown as { itemListElement: { position: number; name: string; item: string }[] };
    expect(crumbs.itemListElement.map((c) => [c.position, c.item])).toEqual([[1, "https://fitron.in/"], [2, `https://fitron.in${page.path}`]]);
  });

  it("offers a free trial of a gym plan, and a way to ask for a demo", () => {
    expect(html.includes('href="/login?tab=up&amp;plan=professional"'), "trial link").toBe(true);
    expect(html.includes('href="/contact?topic=demo"'), "demo link").toBe(true);
  });

  it("keeps clear of claims the product does not back", () => {
    const text = decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "));
    // "Tally" is allowed only to say FITRON does not make a Tally file.
    for (const m of text.matchAll(/tally/gi)) expect(text.slice(Math.max(0, m.index! - 40), m.index! + 40), "Tally").toMatch(/does not create a Tally import file/);
    for (const re of [/\bcompliant\b/i, /\bbest\b/i, /\b(number|no\.?) ?1\b/i, /\bguarantee/i, /\brated\b/i, /\bPDF (financial|report)/i, /\bGSTR[- ]?\d/i])
      expect(re.test(text), `page text must not match ${re}`).toBe(false);
  });
});

describe("the pages about Gym Accounting", () => {
  it("have different titles, descriptions and headings", () => {
    for (const k of ["title", "description", "h1"] as const) expect(new Set(GYM_PAGES.map((p) => p[k])).size, k).toBe(GYM_PAGES.length);
  });

  it("quote the prices on the price list, GST included", () => {
    const html = render(GYM_ACCOUNTING);
    const gym = PLANS.filter((p) => p.product === "GYM_ACCOUNTING");
    const app = graphOf(html).find((g) => g["@type"] === "SoftwareApplication") as unknown as { offers: { name: string; price: number; priceCurrency: string; priceSpecification: { valueAddedTaxIncluded: boolean } }[] };
    expect(app.offers.map((o) => [o.name, o.price, o.priceCurrency])).toEqual(gym.map((p) => [p.name, p.price.MONTHLY / 100, "INR"]));
    for (const o of app.offers) expect(o.priceSpecification.valueAddedTaxIncluded, o.name).toBe(true);
    for (const p of gym) expect(html.includes(`₹${(p.price.MONTHLY / 100).toLocaleString("en-IN")}`), p.name).toBe(true);
  });

  it("agree with the home page about extra branches", () => {
    expect(GYM_ACCOUNTING.faq.some((f) => f.a.includes("Extra branches are ₹499 a month"))).toBe(true);
    expect(decode(home).includes("Extra branches are ₹499 a month")).toBe(true);
  });

  it("describe the GST example with the arithmetic the settings page shows", () => {
    const gst = GYM_PAGES.find((p) => p.path === "/gym-gst-billing")!;
    const settings = gst.blocks.flatMap((b) => b.points ?? []).find((x) => x.startsWith("A ₹1,500 plan"));
    expect(settings).toBe("A ₹1,500 plan is billed as ₹1,500 + CGST 9% + SGST 9% = ₹1,770.");
    expect(gst.faq.some((f) => f.a.includes("₹1,500 plus CGST 9% and SGST 9%, ₹1,770 in all"))).toBe(true);
  });
});

describe("the screenshots on the Gym Accounting pages", () => {
  const shots = GYM_PAGES.flatMap((p) => p.blocks.flatMap((b) => (b.shots ?? []).map((x) => ({ page: p.path, block: b.id, ...x }))));

  it("are real files, small enough to load quickly, with alt text that says what is on the screen", () => {
    expect(shots.length).toBeGreaterThanOrEqual(15);
    for (const x of shots) {
      const file = path.join(root, "public", x.src);
      expect(existsSync(file), x.src).toBe(true);
      expect(statSync(file).size, `${x.src} is under 120 KB`).toBeLessThan(120 * 1024);
      expect(x.src.endsWith(".webp"), x.src).toBe(true);
      expect(x.alt.length, `${x.page}#${x.block} alt text`).toBeGreaterThan(40);
      expect(x.alt.startsWith("FITRON") || x.alt.startsWith("A FITRON"), x.alt).toBe(true);
    }
  });

  it("are drawn at the size of the file, so the page does not jump while they load", () => {
    for (const x of shots) {
      const buf = readFileSync(path.join(root, "public", x.src));
      // WebP (lossy, VP8): 14-bit width and height, little-endian, at bytes 26 and 28.
      expect([buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff], x.src).toEqual([x.width, x.height]);
    }
  });

  it("keep the demo picture out of the first screen: after the page's own text and the section links, and lazy", () => {
    const html = render(GYM_ACCOUNTING);
    expect(html.indexOf('aria-label="On this page"')).toBeGreaterThan(html.indexOf("<h1"));
    expect(html.indexOf("/site/console-dashboard")).toBeGreaterThan(html.indexOf('aria-label="On this page"'));
    expect(html).toMatch(/<img[^>]*console-dashboard[^>]*loading="lazy"|<img[^>]*loading="lazy"[^>]*console-dashboard/);
  });

  it("each pages says they show a demo gym, and every section that has one is on a page that renders it", () => {
    for (const p of GYM_PAGES.filter((q) => q.blocks.some((b) => b.shots))) {
      const html = render(p);
      expect(html).toContain("from FITRON&#x27;s demo gym, with sample members and numbers");
      for (const b of p.blocks) for (const x of b.shots ?? []) expect(html.includes(`src="${x.src}"`) || html.includes(x.src), x.src).toBe(true);
    }
  });
});

describe("the home page's links to them", () => {
  it("leads the title and description with what people search for", () => {
    const title = decode(home.match(/<title>(.*?)<\/title>/)![1]!);
    const description = decode(home.match(/<meta name="description" content="([^"]*)"/)![1]!);
    // The home page leads with the AI personal trainer (its main keyword) and names the gym software next to it.
    expect(title).toBe("FITRON — AI Personal Trainer & Gym Accounting Software");
    expect(title.length).toBeLessThanOrEqual(65);
    expect(description.toLowerCase()).toContain("ai personal trainer");
    expect(description.toLowerCase()).toContain("gym accounting");
    expect(description).toContain("7-day free trial");
    expect(description.length).toBeGreaterThanOrEqual(70);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("links to each page from the footer, and opens the live demo from the Gym Accounting card", () => {
    for (const p of GYM_PAGES) expect(home.includes(`<li><a href="${p.path}">`), p.path).toBe(true);
    expect(home).toMatch(/<a class="hero-partner" href="\/site\/gym-demo\.html"[^>]*data-ld-open[^>]*>Try the live demo<\/a>/);
  });

  it("does not say every payment makes a GST invoice: GST can be switched off", () => {
    const text = decode(home);
    expect(text).not.toContain("Every payment creates a numbered GST invoice");
    expect(text).toContain("When GST is switched on, it shows your GSTIN");
    // The structured data repeats the answer, so a search engine reads the same thing.
    const faq = graphOf(home).find((g) => g["@type"] === "FAQPage") as unknown as { mainEntity: { acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity.some((q) => q.acceptedAnswer.text.includes("When GST is switched on, it shows your GSTIN"))).toBe(true);
  });

  it("describes the Gym Accounting product once, under the address of its own page", () => {
    const g = graphOf(home).filter((x) => x["@type"] === "SoftwareApplication").find((x) => x.name === "FITRON Gym Accounting")!;
    expect(g).toMatchObject({ "@id": "https://fitron.in/gym-accounting#software", url: "https://fitron.in/gym-accounting" });
    expect(graphOf(render(GYM_ACCOUNTING)).find((x) => x["@type"] === "SoftwareApplication")).toMatchObject({ "@id": g["@id"], url: g.url });
    expect(graphOf(home).filter((x) => x["@type"] === "WebSite")).toHaveLength(1);
  });
});
