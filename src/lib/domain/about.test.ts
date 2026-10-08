import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AboutView } from "@/app/(site)/about/about-view";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { isPublicPath } from "@/lib/public-paths";
import { ABOUT, aboutSchema, type AboutData } from "./about";

const root = path.join(__dirname, "../../..");
const home = readFileSync(path.join(root, "public/site/index.html"), "utf8");
const raw = readFileSync(path.join(__dirname, "about-data.json"), "utf8");
const render = (data?: AboutData) => renderToStaticMarkup(createElement(AboutView, data ? { data } : {}));

// Examples for the tests only: they are never read by the site.
const sample: AboutData = {
  founders: [{ name: "Test Person", role: "Founder", bio: "A test biography that is long enough to pass the length rule of the schema.", url: "https://example.org/person" }],
  social: [{ network: "LinkedIn", url: "https://example.org/company" }],
  stories: [{ name: "Test Owner", gym: "Test Gym", city: "Test City", quote: "A test quote that is long enough to pass the schema's rule.", permission: true }],
};

describe("what is said about the people behind FITRON", () => {
  it("is only what has been supplied: the data file is valid, and holds no placeholder text", () => {
    expect(() => aboutSchema.parse(JSON.parse(raw))).not.toThrow();
    expect(/lorem|ipsum|todo|tbd|placeholder|your name|example\.(com|org)|xxx/i.test(raw)).toBe(false);
  });

  it("refuses a customer story without the customer's agreement, and an address that is not https", () => {
    expect(aboutSchema.safeParse({ ...sample, stories: [{ ...sample.stories[0]!, permission: false }] }).success).toBe(false);
    expect(aboutSchema.safeParse({ ...sample, social: [{ network: "X", url: "http://example.org" }] }).success).toBe(false);
    expect(aboutSchema.safeParse({ ...sample, founders: [{ ...sample.founders[0]!, bio: "too short" }] }).success).toBe(false);
  });

  it("has no founder, customer or social section on the page until there is something real to show", () => {
    const html = render({ founders: [], social: [], stories: [] });
    for (const heading of ["Who is behind FITRON", "What customers say", "Follow FITRON"]) expect(html.includes(heading), heading).toBe(false);
    expect(render().includes("Who is behind FITRON")).toBe(ABOUT.founders.length > 0);
  });

  it("shows each section when it has an entry, with the profile links marked as the company's own", () => {
    const html = render(sample);
    for (const needle of ["Who is behind FITRON", "Test Person", "What customers say", "Test Owner", "Follow FITRON", 'rel="me noopener"']) expect(html.includes(needle), needle).toBe(true);
  });

  it("never carries ratings, star counts or review markup", () => {
    const html = render(sample);
    expect(/aggregateRating|ratingValue|reviewCount|"@type":"Review"|★/.test(html)).toBe(false);
  });
});

describe("the About page", () => {
  const html = render();

  it("has one h1, a breadcrumb, structured data that parses, and only statements the product pages make", () => {
    expect([...html.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
    expect(html).toContain('aria-label="Breadcrumb"');
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!.replace(/\\u003c/g, "<"));
    expect(ld["@graph"].map((g: { "@type": string }) => g["@type"])).toEqual(["BreadcrumbList", "AboutPage"]);
    for (const claim of ["FITRON AI Trainer", "FITRON Gym Accounting", "Gym Partnership", "Digital Personal Data Protection Act, 2023", "not medical advice", "70%"]) expect(html.includes(claim), claim).toBe(true);
  });

  it("links to the pages it talks about, and to the policies", () => {
    for (const href of ["/ai-personal-trainer", "/gym-accounting", "/#partnership", "/privacy", "/terms", "/refund", "/contact", "/privacy#grievance"]) expect(html.includes(`href="${href}"`), href).toBe(true);
  });

  it("is open to visitors, in the sitemap and robots.txt, and linked from both footers", () => {
    expect(isPublicPath("/about")).toBe(true);
    expect(sitemap().map((s) => s.url)).toContain("https://fitron.in/about");
    expect((robots().rules as { allow: string[] }).allow).toContain("/about");
    expect(home).toContain('<li><a href="/about">About</a></li>');
    expect(readFileSync(path.join(root, "src/app/(site)/site-footer.tsx"), "utf8")).toContain('["/about", "About"]');
  });
});

describe("the home page's description of the organisation", () => {
  const ld = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!);
  const org = ld["@graph"].find((g: { "@type": string }) => g["@type"] === "Organization");

  it("lists official accounts as sameAs, and a founder, only when the data file has them", () => {
    expect(org.sameAs).toEqual(ABOUT.social.length ? ABOUT.social.map((x) => x.url) : undefined);
    expect(org.founder?.map((f: { name: string }) => f.name)).toEqual(ABOUT.founders.length ? ABOUT.founders.map((f) => f.name) : undefined);
    expect(org.aggregateRating).toBeUndefined();
  });
});
