import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expect, newContext, test } from "./support";

// What a visitor and a search engine get from the public site. The sitemap is the list of pages: every address in it
// has to open, say what it is, and point to itself as its one address.

/**
 * What to print when a sitemap address does not open, so a failure in CI says more than "404": the answer the server gave
 * (status, headers, the start of the body), the same address asked for again at once, and the status of every address in
 * the sitemap now. That shows whether one page or all of them fail, and every time or once. Only called after the check
 * has failed, so a passing run makes no extra requests.
 */
async function explain(request: APIRequestContext, r: APIResponse, locs: string[]) {
  const status = async (path: string) => (await request.get(path, { maxRedirects: 0 })).status();
  const path = new URL(r.url()).pathname;
  const body = (await r.text()).replace(/\s+/g, " ").slice(0, 500);
  return [
    `${r.status()} ${r.statusText()} for ${r.url()}`,
    `headers: ${JSON.stringify(r.headers())}`,
    `body: ${body}`,
    `asked again: ${await status(path)}`,
    "every sitemap address now:",
    ...(await Promise.all(locs.map(async (l) => `  ${await status(new URL(l).pathname)} ${new URL(l).pathname}`))),
  ].join("\n");
}

const attr = (html: string, re: RegExp) => html.match(re)?.[1]?.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

test.describe("search engines", () => {
  test("every address in the sitemap opens and describes itself", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(locs.length).toBeGreaterThanOrEqual(8);
    expect(locs).toContain("https://fitron.in/gym-accounting");

    const titles = new Map<string, string>();
    for (const loc of locs) {
      const url = new URL(loc);
      expect(url.origin, "sitemap addresses are the real site's").toBe("https://fitron.in");
      const r = await request.get(url.pathname, { maxRedirects: 0 });
      expect(r.status(), r.status() === 200 ? loc : `${loc}\n${await explain(request, r, locs)}`).toBe(200);
      const html = await r.text();

      const title = attr(html, /<title[^>]*>([^<]*)<\/title>/);
      expect(title?.length, `${loc} has a title`).toBeGreaterThan(10);
      expect(title!.length, `${loc} has a title that fits a search result`).toBeLessThanOrEqual(70);
      expect(titles.get(title!), `${loc} shares its title with ${titles.get(title!)}`).toBeUndefined();
      titles.set(title!, loc);

      const description = attr(html, /<meta\s+name="description"\s+content="([^"]*)"/) ?? attr(html, /<meta\s+content="([^"]*)"\s+name="description"/);
      expect(description?.length, `${loc} has a description`).toBeGreaterThanOrEqual(50);
      expect(description!.length, `${loc} has a description that is not cut off`).toBeLessThanOrEqual(170);

      const canonical = attr(html, /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/) ?? attr(html, /<link[^>]+href="([^"]+)"[^>]+rel="canonical"/);
      expect(canonical, `${loc} names itself as its one address`).toBe(loc);

      expect([...html.matchAll(/<h1[\s>]/g)].length, `${loc} has one main heading`).toBe(1);

      for (const block of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
        expect(() => JSON.parse(block[1]!), `${loc} has structured data that parses`).not.toThrow();
      }
    }
  });

  test("robots.txt keeps search engines out of the console and points to the sitemap", async ({ request }) => {
    const txt = await (await request.get("/robots.txt")).text();
    expect(txt).toContain("Sitemap: https://fitron.in/sitemap.xml");
    for (const closed of ["/api/", "/login", "/dashboard"]) expect(txt, closed).toContain(`Disallow: ${closed}`);
    for (const open of ["/gym-accounting", "/gym-management-software", "/gym-gst-billing"]) expect(txt, open).toContain(`Allow: ${open}`);
  });

  test("an address that does not exist answers 404 to everyone, and a console address sends a stranger to sign in", async ({ signedIn: page, request }) => {
    expect((await page.request.get("/this/is/not/a/page")).status()).toBe(404);
    const stranger = await request.get("/this/is/not/a/page", { maxRedirects: 0 });
    expect(stranger.status(), "a stranger gets a real 404, which search engines understand").toBe(404);
    expect(await stranger.text()).toContain("wrong turn");
    const console_ = await request.get("/members", { maxRedirects: 0 });
    expect(console_.status()).toBeGreaterThanOrEqual(300);
    expect(console_.headers().location).toContain("/login");
  });
});

test.describe("visitors", () => {
  test("the Gym Accounting pages lead to a free trial and to a demo request", async ({ page }) => {
    for (const path of ["/gym-accounting", "/gym-management-software", "/gym-gst-billing"]) {
      await page.goto(path);
      await expect(page.locator('a[href="/login?tab=up&plan=professional"]').first(), path).toBeVisible();
      await expect(page.locator('a[href="/contact?topic=demo"]').first(), path).toBeVisible();
    }
    await page.goto("/gym-accounting");
    await page.locator('a[href="/login?tab=up&plan=professional"]').first().click();
    await expect(page).toHaveURL(/\/login\?tab=up&plan=professional/);
    await expect(page.getByText("Create your Fitron account")).toBeVisible();
  });

  test("the WhatsApp button does not sit under the cookie banner: it waits until the visitor has chosen", async ({ browser }) => {
    for (const width of [390, 768, 1024]) {
      const ctx = await newContext(browser, { viewport: { width, height: 800 } });
      await ctx.clearCookies(); // no choice made yet, so the banner opens
      const page = await ctx.newPage();
      await page.goto("/");
      await expect(page.locator(".consent.show"), `banner at ${width}px`).toBeVisible();
      await expect(page.locator(".wa-float"), `WhatsApp button at ${width}px`).toBeHidden();
      await page.locator(".consent .btn").first().click();
      await expect(page.locator(".consent.show")).toHaveCount(0);
      await expect(page.locator(".wa-float"), `WhatsApp button after the choice at ${width}px`).toBeVisible();
      await ctx.close();
    }
  });

  test("the contact form needs a message and says so", async ({ page }) => {
    await page.goto("/contact");
    await page.getByRole("button", { name: /send|submit/i }).first().click();
    await expect(page).toHaveURL(/\/contact/);
    await expect(page.getByRole("alert").or(page.getByText(/enter|required|check/i)).first()).toBeVisible();
  });

  test("the Gym Accounting live demo opens, and its Fitron AI asks the demo endpoint and still answers without a key", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/site/gym-demo.html");
    await page.locator("input[type=email]").fill("sumit@powerhausgym.in");
    await page.locator("input[type=password]").fill("fitron123");
    await page.locator("input[type=password]").press("Enter");
    await page.getByRole("button", { name: "Essential only" }).click();
    // The product tour opens on a first sign-in, a moment after the console.
    await page.getByRole("button", { name: "Skip tour" }).click({ timeout: 5000 }).catch(() => {});
    await page.locator("aside button").filter({ hasText: "Fitron AI" }).first().click();
    const asked = page.waitForResponse("**/api/gym-demo/ai");
    const box = page.getByPlaceholder("Ask anything about your gym…");
    await box.fill("Who owes us money?");
    await box.press("Enter");
    // No ANTHROPIC_API_KEY here: the endpoint says so and the demo answers from its built-in replies.
    expect((await asked).status()).toBe(503);
    await expect(page.locator("main").getByText(/is outstanding across \d+ members/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the legal pages are there", async ({ page }) => {
    for (const [path, heading] of [["/privacy", /privacy/i], ["/terms", /terms/i], ["/refund", /refund|cancellation/i]] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }), path).toContainText(heading);
    }
  });
});
