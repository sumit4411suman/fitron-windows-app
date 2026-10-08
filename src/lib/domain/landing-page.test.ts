import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { NAV } from "@/lib/nav";
import { isPublicPath } from "@/lib/public-paths";
import { ASSISTANT_NAME, ASSISTANT_PATH, FACTS, SUGGESTED_QUESTIONS } from "./assistant";
import { PARTNER_SHARE, PLANS } from "./pricing";
import { gstInside } from "./saas";
import { COACH_DAILY_LIMIT } from "./trainer";
import { PLAN_FEATURES, PRIORITY_SUPPORT_PLANS, type Feature } from "./features";

const root = path.join(__dirname, "../../..");
const html = readFileSync(path.join(root, "public/site/index.html"), "utf8");
/** The page's visible words: scripts and styles removed, tags stripped, entities decoded for the few we use. */
const text = html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

describe("what the home page promises matches the product", () => {
  it("does not promise a Tally file: Gym Accounting exports Excel and CSV", () => {
    expect((/tally/i).test(html), "html must not match " + String(/tally/i)).toBe(false);
    expect(text.includes("Excel or CSV files for your accountant"), "Excel or CSV files for your accountant").toBe(true);
  });

  it("says plans renew automatically and that prices include GST", () => {
    for (const re of [/auto-?debit/i, /exclusive of (applicable )?GST/i, /simply don't renew/i, /nothing to cancel/i]) expect(re.test(text), `text must not match ${re}`).toBe(false);
    for (const s of ["plans renew automatically and you can cancel any time", "Plans renew automatically through Razorpay", "inclusive of GST", "inclusive of 18% GST"]) expect(text.includes(s), s).toBe(true);
    expect(html.includes('"valueAddedTaxIncluded": false')).toBe(false);
  });

  it("counts the gym modules the way the sidebar does", () => {
    const sections = NAV.flatMap((g) => g.items).length;
    expect((new RegExp(`\\b${sections} Gym modules`)).test(text), "text should match " + String(new RegExp(`\\b${sections} Gym modules`))).toBe(true);
    // Every place the page counts them says the same number (the product card and the partner perks said 22 once).
    const counts = [...text.matchAll(/\b(\d+) (?:Gym )?modules\b/gi)].map((m) => Number(m[1]));
    expect(counts.length).toBeGreaterThanOrEqual(2);
    expect(counts.filter((n) => n !== sections)).toEqual([]);
  });
});

describe("AI Pro and AI Premium on the home page", () => {
  const card = (name: string) => {
    const i = html.indexOf(`<h3>${name}</h3>`);
    return html.slice(i, html.indexOf("</article>", i));
  };
  const bullets = (name: string) => [...card(name).matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
  const pro = COACH_DAILY_LIMIT["ai-pro"];
  const premium = COACH_DAILY_LIMIT["ai-premium"];

  it("states each tier's daily AI Coach limit, the numbers the server enforces", () => {
    expect(bullets("AI Pro")).toContain(`AI Coach: ${pro} messages a day`);
    expect((/monthly usage limits/).test(text), "text must not match " + String(/monthly usage limits/)).toBe(false);
  });

  it("lists as Premium-only just what the app really gives Premium and not Pro: the higher coach limit", () => {
    // Every other feature (workouts, food plan, habits, progress, reminders, weekly review) is the same on both
    // tiers in the app. When a feature is built that only Premium has, add it here and to the card.
    expect(bullets("AI Premium")).toEqual(["Everything in AI Pro, plus", `AI Coach: ${premium} messages a day`]);
    expect(premium).toBeGreaterThan(pro);
  });

  it("uses the same one-line description as src/lib/domain/pricing.ts", () => {
    for (const [name, key] of [["AI Pro", "ai-pro"], ["AI Premium", "ai-premium"]] as const) {
      const who = card(name).match(/class="pc-who">(.*?)<\/p>/)?.[1];
      expect(who, name).toBe(PLANS.find((p) => p.key === key)!.tagline);
    }
  });

  it("matches the limit the AI Trainer app shows its members", () => {
    const app = readFileSync(path.join(root, "public/trainer/index.html"), "utf8");
    expect(app.includes(`st.tier === 'ai-premium' ? ${premium} : ${pro}`), `st.tier === 'ai-premium' ? ${premium} : ${pro}`).toBe(true);
  });
});

describe("exports and support promised on the plan cards", () => {
  it("does not promise PDF financial exports: only invoices come out as PDF (reports and ledgers are Excel and CSV)", () => {
    expect(text.includes("PDF financial"), "PDF financial").toBe(false);
    expect(text.includes("Excel and CSV accounting exports"), "Excel and CSV accounting exports").toBe(true);
    expect(PLANS.find((p) => p.key === "professional")!.card!.features).toContain("Excel and CSV accounting exports");
  });

  it("promises priority support exactly on the plans whose tickets are marked priority", () => {
    const cards = [...html.matchAll(/<article class="pc[ "][\s\S]*?<\/article>/g)].map((m) => m[0]);
    const withPriority = cards.filter((c) => /<li[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span>Priority [a-z ]*support<\/span>/.test(c)).map((c) => c.match(/<h3>(.*?)<\/h3>/)![1]!.trim());
    const keys = PLANS.filter((p) => withPriority.includes(p.name)).map((p) => p.key);
    expect(withPriority.length).toBeGreaterThan(0);
    expect(keys.sort()).toEqual([...PRIORITY_SUPPORT_PLANS].sort());
  });
});

describe("the redesigned home page", () => {
  const section = (id: string) => {
    const i = html.indexOf(`id="${id}"`);
    expect(i, id).toBeGreaterThan(0);
    return html.slice(i, html.indexOf("</section>", i));
  };

  it("keeps the anchors other pages and the footer link to", () => {
    for (const id of ["top", "products", "together", "partnership", "pricing", "faq"]) expect(html.includes(`id="${id}"`), `#${id}`).toBe(true);
  });

  it("has one h1, with the headline of the brief", () => {
    expect([...html.matchAll(/<h1[\s>]/g)]).toHaveLength(1);
    expect(text.includes("Your AI trainer. Your gym's accounts.")).toBe(true);
  });

  it("links the header to the product pages and offers Sign In and Get Started, on phones too", () => {
    const header = html.slice(html.indexOf('<header class="nav"'), html.indexOf("</header>"));
    for (const href of ["/ai-personal-trainer", "/gym-accounting", "#together", "#partnership", "#pricing", "#faq", "/signin"]) expect(header.includes(`href="${href}"`), href).toBe(true);
    expect(header).toContain(">Get Started<");
    const menu = html.slice(html.indexOf('<nav class="mobile-menu"'), html.indexOf("</nav>", html.indexOf('<nav class="mobile-menu"')));
    for (const label of ["AI Trainer", "Gym Accounting", "Better Together", "Partner With Us", "Pricing", "FAQ", "Contact", "Sign In", "Get Started"]) expect(menu.includes(label), label).toBe(true);
  });

  it("opens with the two buttons and the trust bar of the brief", () => {
    const hero = section("hero-title");
    for (const label of ["Start Free Trial", "Explore Gym Accounting", "Partner With FITRON"]) expect(hero.includes(label), label).toBe(true);
    const bar = html.slice(html.indexOf('<section class="trustbar"'), html.indexOf("</section>", html.indexOf('<section class="trustbar"')));
    const items = [...bar.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
    expect(items).toEqual(["7-day free trial", "No card needed", "Pay by UPI or card", "GST-ready", "Excel export", "DPDP-compliant"]);
  });

  it("asks for the hero screenshot first, and sends small screens a smaller file", () => {
    expect(html.indexOf('rel="preload" as="image"')).toBeLessThan(html.indexOf("<style>"));
    const hero = html.slice(html.indexOf('id="heroVisual"'), html.indexOf("</section>", html.indexOf('id="heroVisual"')));
    expect(hero).toContain("gym-dashboard-720.webp 720w");
    expect(hero).toContain("app-home-300.webp 300w");
    expect([...hero.matchAll(/ sizes="/g)]).toHaveLength(2);
  });

  it("fetches nothing below the first screen ahead of it: the product pictures and the hidden assistant's logo are lazy", () => {
    expect(html.includes('loading="eager"')).toBe(false);
    expect(html).toMatch(/<img data-gallery-img="" src="\/site\/coach-demo\.webp"[^>]*loading="lazy"/);
    expect(html).toMatch(/<img class="ld-poster" loading="lazy"/);
    const widget = html.slice(html.indexOf("<!--fitron:assistant-->"), html.indexOf("<!--/fitron:assistant-->"));
    for (const img of widget.match(/<img [^>]*>/g) ?? []) expect(img, img).toContain('loading="lazy"');
  });

  it("shows both products in the hero, from the real screenshots, with alt text", () => {
    const hero = html.slice(html.indexOf('id="heroVisual"'), html.indexOf("</section>", html.indexOf('id="heroVisual"')));
    expect(hero).toContain("/site/app-home.webp");
    expect(hero).toContain("/site/gym-dashboard.webp");
    for (const alt of [...hero.matchAll(/<img[^>]*alt="([^"]*)"/g)].map((m) => m[1]!).filter(Boolean)) expect(alt.length).toBeGreaterThan(30);
  });

  it("frames the hero screenshots as a laptop and a phone, each opening its product's home page, and never hides them on short phones", () => {
    const hero = html.slice(html.indexOf('id="heroVisual"'), html.indexOf("</section>", html.indexOf('id="heroVisual"')));
    expect(hero).toMatch(/<a class="duo-laptop" href="\/gym-accounting"/);
    expect(hero).toMatch(/<a class="duo-phone" href="\/ai-personal-trainer"/);
    expect(hero).toContain("laptop-screen");
    expect(hero).toContain("phone-screen");
    // A rule that hid the visual on phones shorter than 760px removed it from most real phones.
    expect(html.includes("@media (max-width:900px) and (max-height:760px){.hero-visual{display:none}}")).toBe(false);
  });

  it("says AI answers are general guidance, not medical advice, where the coach is shown", () => {
    expect((/not medical advice/i).test(section("coach"))).toBe(true);
    expect((/not medical/i).test(section("nutrition"))).toBe(true);
  });

  it("labels the sample screens as examples and makes no promise of results", () => {
    for (const id of ["ai-trainer", "nutrition", "workouts", "coach", "progress"]) expect((/sample|example/i).test(section(id)), id).toBe(true);
    // "Not guaranteed" disclaimers are the opposite of a promise; a guaranteed result or a number of kilos is one.
    expect((/guarantee[ds]? (results|weight|fat|muscle)|lose \d+ ?kg|results in \d+/i).test(text)).toBe(false);
  });

  it("works out the partner earnings from the real prices and share, and calls them illustrative", () => {
    const part = section("partner-earnings");
    const share = (key: string) => Math.round(gstInside(PLANS.find((p) => p.key === key)!.price.MONTHLY).base * PARTNER_SHARE);
    expect(part).toContain(`data-pro="${share("ai-pro")}"`);
    expect(part).toContain(`data-premium="${share("ai-premium")}"`);
    for (const key of ["ai-pro", "ai-premium"]) expect(part, key).toContain(`<span class="rs">₹</span>${Math.round(share(key) / 100)}</b>`);
    expect(part).toContain(`Your gym ${Math.round(PARTNER_SHARE * 100)}%`);
    expect((/subject to eligibility, applicable deductions, refunds, chargebacks, verification and the signed partnership agreement/).test(part)).toBe(true);
    expect((/not guaranteed income/).test(part)).toBe(true);
    const header = html.slice(html.indexOf('<header class="nav"'), html.indexOf("</header>"));
    expect(header).toContain('href="#partner-earnings"');
  });

  it("offers the Partner Console demo, built for gym partners only, with the real share", () => {
    const part = section("partner-earnings");
    expect(part).toContain('data-src="/site/partner-demo.html"');
    const demo = readFileSync(path.join(root, "public/site/partner-demo.html"), "utf8");
    const tpl = JSON.parse(demo.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/)![1]!) as string;
    expect(tpl).toContain("role: 'gym', screen: 'dash',");
    expect(tpl).toContain("[['gym','Gym partner','barbell']]");
    expect(tpl).not.toContain("['owner','Owner'");
    expect(tpl).toContain(`const G0 = ${Math.round(PARTNER_SHARE * 100)};`);
  });

  it("calls the revenue share conditional wherever it is promised", () => {
    const part = section("partnership");
    expect(part.includes("70%")).toBe(true);
    expect((/subject to eligibility, applicable deductions, refunds, chargebacks, verification and the signed partnership agreement/).test(part)).toBe(true);
    expect((/not guaranteed income/).test(part)).toBe(true);
    for (const model of ["Referral Partner", "Software Partner", "Enterprise Partner"]) expect(part.includes(model), model).toBe(true);
    expect(section("together").includes("never shown to gym staff")).toBe(true);
  });

  it("shows a Gym Accounting comparison table whose ticks are what each plan opens in the console", () => {
    const table = html.slice(html.indexOf('data-cmp="gym"'), html.indexOf("</table>", html.indexOf('data-cmp="gym"')));
    const plans = ["starter", "professional", "enterprise"] as const;
    const rows = [...table.matchAll(/<tr data-feature="([a-z]+)">(.*?)<\/tr>/g)];
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const [, feature, cells] of rows) {
      const marks = [...cells!.matchAll(/<td class="([yn])">/g)].map((m) => m[1] === "y");
      expect(marks, feature).toEqual(plans.map((k) => PLAN_FEATURES[k]!.includes(feature as Feature)));
    }
    for (const p of PLANS.filter((x) => x.product === "GYM_ACCOUNTING")) expect(table.includes(`<td>₹${(p.price.MONTHLY / 100).toLocaleString("en-IN")}</td>`) || (p.card?.limit ?? "").length > 0, p.name).toBe(true);
  });

  it("shows the AI Coach limits of the AI plans table, the numbers the server enforces", () => {
    const table = html.slice(html.indexOf('data-cmp="ai"'), html.indexOf("</table>", html.indexOf('data-cmp="ai"')));
    expect(table).toContain(`data-coach="ai-pro">${COACH_DAILY_LIMIT["ai-pro"]} a day`);
    expect(table).toContain(`data-coach="ai-premium">${COACH_DAILY_LIMIT["ai-premium"]} a day`);
  });

  it("groups the FAQ by category and answers the questions of the brief", () => {
    for (const q of ["Is FITRON available in India?", "Do I need a gym to use the AI trainer?", "How long is the free trial?", "How does Gym Accounting work?", "support GST invoices", "export my data to Excel", "more than one branch", "How does the gym partnership work?", "How does the 70% revenue share work?", "How do I cancel?", "What happens to my data?", "medical advice"]) expect(text.includes(q.replace("support GST invoices", "handle GST")) || text.toLowerCase().includes(q.toLowerCase()), q).toBe(true);
    expect([...html.matchAll(/class="faq-cat[^"]*" id="faq-/g)].length).toBeGreaterThanOrEqual(5);
  });

  it("has a five-column footer with every legal page and the cookie settings", () => {
    const footer = html.slice(html.indexOf('<footer id="siteEnd"'), html.indexOf("</footer>"));
    for (const h of ["Products", "Business", "Company", "Legal"]) expect(footer.includes(`>${h}</p>`), h).toBe(true);
    for (const href of ["/privacy", "/terms", "/refund", "/privacy#cookies", "/privacy#rights", "/privacy#grievance", "/terms#partners", "/contact#company", "/guides"]) expect(footer.includes(`href="${href}"`), href).toBe(true);
    expect(footer).toContain("data-cookie-settings");
    expect(footer.includes("© 2026 FITRON")).toBe(true);
  });

  it("lets visitors accept all, choose essential only or manage settings, and uses no advertising cookies", () => {
    const banner = html.slice(html.indexOf('id="consent"'), html.indexOf("</div>\n</div>", html.indexOf('id="consent"')));
    for (const needle of ['data-consent="all"', 'data-consent="essential"', "data-consent-manage", 'id="consentAnalytics"', 'id="consentPrefs"', "No advertising cookies"]) expect(banner.includes(needle), needle).toBe(true);
  });

  it("names every tracked event with one the analytics doc lists", () => {
    const doc = readFileSync(path.join(root, "docs/ANALYTICS.md"), "utf8");
    const names = new Set([...html.matchAll(/data-track="([a-z_]+)"/g)].map((m) => m[1]!));
    expect(names.size).toBeGreaterThan(5);
    for (const n of names) expect(doc.includes(`\`${n}\``), n).toBe(true);
  });

  it("loads the analytics tracker, which waits for consent", () => {
    expect(html.includes('<script src="/site/analytics.js" defer></script>')).toBe(true);
    const js = readFileSync(path.join(root, "public/site/analytics.js"), "utf8");
    expect(js).toContain("c.analytics");
    expect(js).toContain("/api/analytics-config");
  });
});

describe("the live AI Coach demo in the AI Trainer card", () => {
  const card = html.slice(html.indexOf('id="coachDemo"'), html.indexOf("</article>", html.indexOf('id="coachDemo"')));

  it("is a button over the coach's picture that loads the demo page only when pressed, and says it is a sample", () => {
    expect(card).toContain('data-src="/site/coach-demo.html"');
    expect(card).toContain("data-cd-play");
    expect(html.includes('<iframe src="/site/coach-demo.html"'), "the 3 MB demo must not load with the page").toBe(false);
    expect(card).toMatch(/Live demo with a sample member\. General guidance, not medical advice\./);
    expect(card).toMatch(/data-cd-open[^>]*>Chat with the AI coach</);
  });

  it("counts its buttons as demo requests, which the analytics doc lists", () => {
    expect(card.match(/data-track="demo_request"/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("is built from files that exist, and the demo page asks the open endpoint, not the signed-in one", () => {
    for (const f of ["public/site/coach-demo.html", "public/site/coach-demo.webp", "src/app/api/coach/demo/route.ts"]) expect(existsSync(path.join(root, f)), f).toBe(true);
    const demo = readFileSync(path.join(root, "public/site/coach-demo.html"), "utf8");
    // The template is stored as JSON inside the page, so the quotes in what we look for are escaped.
    expect(demo).toContain("fetch('/api/coach/demo'");
    expect(demo.includes("fetch('/api/coach',")).toBe(false);
  });

  it("keeps its data out of the AI Trainer app's: every storage name starts with fitron-demo", () => {
    const demo = readFileSync(path.join(root, "public/site/coach-demo.html"), "utf8");
    const names = new Set([...demo.matchAll(/(?:get|set|remove)Item\(\s*'([^']+)'/g)].map((m) => m[1]!));
    expect(names.size).toBeGreaterThan(3);
    for (const n of names) expect(n, n).toMatch(/^fitron-demo\./);
  });

  it("does not depend on a script host: React is in the file", () => {
    const demo = readFileSync(path.join(root, "public/site/coach-demo.html"), "utf8");
    expect(demo).not.toMatch(/window\.__resources=\{/);
  });
});

describe("home page files", () => {
  it("every local image, script and font it uses exists", () => {
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"#?]+\.(?:png|webp|jpg|svg|js|woff2|ico))/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(5);
    for (const r of new Set(refs)) expect(existsSync(path.join(root, "public", r)), r).toBe(true);
  });

  it("serves the product screenshots as WebP, with real alt text on the AI Trainer one", () => {
    expect(html.includes("/site/app-dashboard.webp"), "/site/app-dashboard.webp").toBe(true);
    expect(html.includes("/site/console-dashboard.webp"), "/site/console-dashboard.webp").toBe(true);
    expect((/(app|console)-dashboard\.png/).test(html), "html must not match " + String(/(app|console)-dashboard\.png/)).toBe(false);
    const alt = html.match(/<img data-gallery-img="" src="[^"]+" alt="([^"]*)"/)?.[1] ?? "";
    expect(alt.length).toBeGreaterThan(30);
  });

  it("downloads the 3D logo library only for visitors who haven't asked for less motion or data, and only when idle", () => {
    expect([...html.matchAll(/import\('\/site\/fitron-3d\.js'\)/g)]).toHaveLength(1);
    for (const needle of ["prefers-reduced-motion", "saveData", "requestIdleCallback", "const load3d"]) expect(html.includes(needle), needle).toBe(true);
    // ... nor where the browser cannot run WebGL (the library would only log an error), and only when the closing section is near.
    for (const needle of ["const webgl", "WEBGL_lose_context", "getElementById('join')", "rootMargin: '1200px 0px'"]) expect(html.includes(needle), needle).toBe(true);
  });

  it("keeps the cookie banner and the WhatsApp button off the open phone menu", () => {
    expect((/body\.menu-open \.consent,body\.menu-open \.wa-float\{[^}]*pointer-events:none/).test(html), "html should match " + String(/body\.menu-open \.consent,body\.menu-open \.wa-float\{[^}]*pointer-events:none/)).toBe(true);
  });

  it("lays the hero out in one column on phones (the design's own rule was overridden, so the text ran off the screen)", () => {
    expect(html.includes("@media (max-width:900px){body .hero{grid-template-columns:minmax(0,1fr)}"), "@media (max-width:900px){body .hero{grid-template-columns:minmax(0,1fr)}").toBe(true);
    expect(html.includes("body .hero-copy{min-width:0}"), "body .hero-copy{min-width:0}").toBe(true);
    expect(html.includes("body .float-card.fc-1{left:0}body .float-card.fc-2{right:0}"), "body .float-card.fc-1{left:0}body .float-card.fc-2{right:0}").toBe(true);
  });

  it("moves keyboard focus into the phone menu, makes the page behind it inert, and gives focus back when it closes", () => {
    for (const needle of ["fitron:menu-a11y", "document.querySelectorAll('main, footer, .wa-float')", "setAttribute('inert', '')", "menu.querySelector('a')", "btn.focus("]) expect(html.includes(needle), needle).toBe(true);
  });

  it("puts the floating WhatsApp link inside a landmark", () => {
    const wrapped = '<aside aria-label="Quick contact"><a class="wa-float"';
    expect(html.includes(wrapped), wrapped).toBe(true);
    expect([...html.matchAll(/class="wa-float"/g)]).toHaveLength(1);
  });

  it("keeps the pricing tab bar inside the screen on phones", () => {
    const rule = "body .seg.p-tabs label>span{font-size:clamp(";
    expect(html.includes(rule), rule).toBe(true);
    expect(html.includes("body .seg.p-tabs{max-width:100%}"), "tab bar max-width").toBe(true);
  });

  it("links to the company details on the Contact page", () => {
    expect(html.includes('href="/contact#company"'), 'href="/contact#company"').toBe(true);
  });
});

describe("home page structured data", () => {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "";
  const graph = (JSON.parse(raw || "{}")["@graph"] ?? []) as { "@type": string; name?: string; offers?: { name: string; price: number; priceCurrency: string }[]; mainEntity?: { name: string; acceptedAnswer: { text: string } }[] }[];
  const ofType = (t: string) => graph.filter((g) => g["@type"] === t);

  it("describes the organisation, both products and the FAQ", () => {
    expect(ofType("Organization")).toHaveLength(1);
    expect(ofType("SoftwareApplication").map((a) => a.name)).toEqual(["FITRON AI Trainer", "FITRON Gym Accounting"]);
    expect(ofType("FAQPage")).toHaveLength(1);
  });

  it("lists every plan at its real monthly price in rupees, GST included", () => {
    const offers = ofType("SoftwareApplication").flatMap((a) => a.offers ?? []);
    const plans = PLANS.filter((p) => p.product !== "PARTNER");
    expect(offers.map((o) => o.name)).toEqual(plans.map((p) => p.name));
    for (const p of plans) expect(offers.find((o) => o.name === p.name), p.name).toMatchObject({ price: p.price.MONTHLY / 100, priceCurrency: "INR", priceSpecification: { valueAddedTaxIncluded: true } });
  });

  it("repeats exactly the questions and answers a visitor can read in the FAQ", () => {
    const shown = [...html.matchAll(/<details><summary>(.*?)<\/summary>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
    const asked = ofType("FAQPage")[0]!.mainEntity!;
    expect(asked.map((q) => q.name)).toEqual(shown);
    expect(shown.length).toBeGreaterThanOrEqual(12);
    for (const q of asked) expect(text.includes(q.acceptedAnswer.text.slice(0, 60)), q.name).toBe(true);
  });
});

describe("what search engines are told", () => {
  it("lists only pages that stay put, and does not allow the sign-up redirect", () => {
    const urls = sitemap().map((s) => s.url);
    expect(urls).toContain("https://fitron.in/");
    expect(urls.some((u) => /signup|signin|login/.test(u))).toBe(false);
    const rules = robots().rules;
    const rule = (Array.isArray(rules) ? rules[0] : rules) as { allow: string[]; disallow: string[] };
    expect(rule.allow).not.toContain("/signup");
    for (const p of ["/login", "/signin", "/signup"]) expect(rule.disallow, p).toContain(p);
  });

  it("has no hand-typed last-modified date", () => {
    expect(sitemap().every((s) => s.lastModified === undefined)).toBe(true);
  });
});

describe("Fitron Assistant on the home page", () => {
  const widget = html.match(/<!--fitron:assistant-->([\s\S]*?)<!--\/fitron:assistant-->/)?.[1] ?? "";
  const script = widget.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";

  it("is on the page once, as a landmark with its name, and shows only when scripts run", () => {
    expect(widget.length).toBeGreaterThan(1000);
    expect([...html.matchAll(/id="fitronAssistant"/g)]).toHaveLength(1);
    expect(widget).toContain(`<aside class="fa" id="fitronAssistant" aria-label="${ASSISTANT_NAME}" hidden>`);
    expect(widget).toContain(`<b>${ASSISTANT_NAME}</b>`);
    expect(widget).toContain('role="dialog"');
    // The panel's heading is not an h1/h2: the page keeps its one h1 and its own heading order.
    expect(/<h[1-6][\s>]/.test(widget)).toBe(false);
  });

  it("asks the endpoint that answers it", () => {
    expect(script.includes(`API = '${ASSISTANT_PATH}'`), `API = '${ASSISTANT_PATH}'`).toBe(true);
    expect(isPublicPath(ASSISTANT_PATH)).toBe(true);
  });

  it("offers the questions the server knows how to answer", () => {
    const asked = [...widget.matchAll(/data-q="([^"]+)"/g)].map((m) => m[1]);
    expect(asked).toEqual([...SUGGESTED_QUESTIONS]);
  });

  it("only turns addresses into links when they lead to a public page of the site", () => {
    const pages = script.match(/var PAGES = '([^']+)'/)?.[1].split("|") ?? [];
    expect(pages.length).toBeGreaterThan(8);
    for (const p of pages) expect(isPublicPath(`/${p}`), p).toBe(true);
    // Every page an answer sends visitors to is one of them, so the link works.
    const sent = new Set(FACTS.flatMap((f) => [...f.answer.matchAll(/(?<![\w/:.])\/([a-z][\w-]*)/g)].map((m) => m[1]!)));
    for (const p of sent) expect(pages, p).toContain(p);
  });

  it("builds answers from text, never as HTML, and runs nothing it was sent", () => {
    for (const bad of ["eval(", "document.write", "insertAdjacentHTML", "new Function"]) expect(script.includes(bad), bad).toBe(false);
    // The one innerHTML is the three dots of "typing", a fixed string.
    expect([...script.matchAll(/innerHTML/g)]).toHaveLength(1);
    expect(script.includes("typingEl.innerHTML = '<i></i><i></i><i></i>")).toBe(true);
  });

  it("stays out of the way of the phone menu and the cookie banner, and of printing", () => {
    for (const rule of ["body.menu-open .fa{", "body:has(.consent.show) .fa{", "@media print{.fa{display:none}}"]) expect(html.includes(rule), rule).toBe(true);
  });

  it("keeps the page's promises: it adds no words the other tests forbid", () => {
    expect((/tally/i).test(widget), "widget must not match /tally/i").toBe(false);
  });
});

// scripts/import-site.py rebuilds the page and applies scripts/site_patches.py last, so the committed page must be
// what the patches produce: if someone edits the page by hand, or a patch changes, this fails until they agree.
const python = spawnSync("python3", ["--version"]).status === 0;
describe.skipIf(!python)("scripts/site_patches.py", () => {
  it("leaves the committed home page unchanged", () => {
    const copy = path.join(mkdtempSync(path.join(tmpdir(), "fitron-site-")), "index.html");
    copyFileSync(path.join(root, "public/site/index.html"), copy);
    const r = spawnSync("python3", [path.join(root, "scripts/site_patches.py"), copy], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("Already up to date");
  });
});
