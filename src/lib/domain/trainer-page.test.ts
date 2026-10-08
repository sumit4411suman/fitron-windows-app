import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Page, { metadata } from "@/app/(site)/ai-personal-trainer/page";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { isPublicPath } from "@/lib/public-paths";
import { GYM_PAGES } from "./gym-pages";
import { DATA_SAFETY, SCREENSHOTS, TRAINER_PAGE as page } from "./trainer-page";

const root = path.join(__dirname, "../../..");
const home = readFileSync(path.join(root, "public/site/index.html"), "utf8");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const html = renderToStaticMarkup(createElement(Page));
type Node = Record<string, unknown> & { "@type": string };
const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!)["@graph"] as Node[];

describe(page.path, () => {
  it("has a title and description that fit a search result", () => {
    expect(page.title.length).toBeGreaterThanOrEqual(30);
    expect(page.title.length).toBeLessThanOrEqual(65);
    expect(page.description.length).toBeGreaterThanOrEqual(70);
    expect(page.description.length).toBeLessThanOrEqual(160);
    expect(page.title.includes("FITRON")).toBe(true);
  });

  it("is indexable, with one canonical address and a link preview", () => {
    expect(metadata.alternates?.canonical).toBe(`https://fitron.in${page.path}`);
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    expect(metadata.openGraph).toMatchObject({ url: `https://fitron.in${page.path}`, title: page.title });
  });

  it("has one main heading and a linkable id on every section", () => {
    expect([...html.matchAll(/<h1[ >]/g)]).toHaveLength(1);
    expect(decode(html.match(/<h1[^>]*>(.*?)<\/h1>/)![1]!)).toBe(page.h1);
    expect(html.includes('id="screenshots"') && html.includes('id="demo"') && html.includes('id="app-info"')).toBe(true);
    for (const b of page.blocks) expect(html.includes(`id="${b.id}"`), b.id).toBe(true);
  });

  it("repeats exactly the questions a visitor can read, in its structured data", () => {
    const faq = graph.find((g) => g["@type"] === "FAQPage") as unknown as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    const shown = [...html.matchAll(/<summary[^>]*>(.*?)<\/summary><p[^>]*>(.*?)<\/p>/g)].map((m) => [decode(m[1]!), decode(m[2]!)]);
    expect(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(shown);
    expect(shown).toEqual(page.faq.map((f) => [f.q, f.a]));
  });

  it("only links to pages that exist", () => {
    const known = new Set(["/", "/trainer", "/site/coach-demo.html", "/privacy", "/about", "/contact", "/tools/protein-calculator", "/tools/calorie-calculator", ...GYM_PAGES.map((p) => p.path)]);
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => decode(m[1]!).split(/[?#]/)[0] || "/");
    expect(links.filter((l) => !known.has(l))).toEqual([]);
  });

  it("is open to visitors, in the sitemap, allowed in robots.txt and linked from the home page", () => {
    expect(isPublicPath(page.path)).toBe(true);
    expect(sitemap().map((s) => s.url)).toContain(`https://fitron.in${page.path}`);
    const rule = robots().rules as { allow: string[]; disallow: string[] };
    expect(rule.allow).toContain(page.path);
    expect(home.includes(`href="${page.path}"`)).toBe(true);
    expect(home).toContain('"@id": "https://fitron.in/ai-personal-trainer#software"');
  });

  it("shows every app screenshot, each a real file with a description", () => {
    const gallery = html.slice(html.indexOf('id="screenshots"'), html.indexOf('id="demo"'));
    for (const shot of SCREENSHOTS) {
      expect(existsSync(path.join(root, "public/site/trainer", `${shot.id}.webp`)), shot.id).toBe(true);
      expect(gallery).toContain(`src="/site/trainer/${shot.id}.webp"`);
      expect(shot.alt.length, shot.id).toBeGreaterThan(30);
    }
    expect(new Set(SCREENSHOTS.map((s) => s.id)).size).toBe(SCREENSHOTS.length);
    for (const b of page.blocks) if ("shot" in b) expect(SCREENSHOTS.some((s) => s.id === b.shot), b.id).toBe(true);
  });

  it("makes no claim a store listing would need proof for: no ratings, reviews or download counts", () => {
    const text = decode(html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " "));
    expect(text).not.toMatch(/★|\bstars?\b|\bratings?\b|\buser reviews?\b|\bdownloads\b|\d+ ?[kKL]\+/i);
    expect(DATA_SAFETY.length).toBeGreaterThan(0);
  });

  it("shows the whole app as a live demo, a lazy picture with a play button, and says it is a sample, not medical advice", () => {
    const fig = html.slice(html.indexOf("<figure"), html.indexOf("</figure>"));
    expect(fig).toContain('src="/site/trainer/home.webp"');
    expect(fig).toContain('loading="lazy"');
    expect(fig).toContain("Open the live demo app");
    expect(fig).toMatch(/A sample member, not your data\. General guidance, not medical advice\./);
    // The demo itself (3 MB) is loaded only when it is played, so there is no frame yet, only the link to open it in a tab.
    expect(html.includes("<iframe"), "no frame in the first render").toBe(false);
    expect(fig).toContain('href="/site/coach-demo.html#home"');
    const alt = fig.match(/alt="([^"]*)"/)?.[1] ?? "";
    expect(alt.length).toBeGreaterThan(30);
  });
});
