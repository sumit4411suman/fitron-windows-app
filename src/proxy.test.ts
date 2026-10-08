import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GYM_PAGES } from "@/lib/domain/gym-pages";
import { CONSOLE_SEGMENTS, isGuardedPath, isPublicPath } from "@/lib/public-paths";
import { config, proxy } from "./proxy";

const matcher = new RegExp(`^${config.matcher[0]}$`);
/** Whether the proxy runs for this path at all. */
const runs = (p: string) => matcher.test(p);
const visit = (p: string, cookie = false) => proxy(new NextRequest(`http://localhost${p}`, { headers: cookie ? { cookie: "fitron_session=abc" } : {} }));

afterEach(() => vi.unstubAllEnvs());

describe("which paths are open to visitors who are not signed in", () => {
  it.each(["/", "/signin", "/login", "/signup", "/trainer", "/contact", "/privacy", "/terms", "/refund", "/c/power-haus-gym/cm1abc", "/verify-email", "/forgot-password", "/reset-password", "/auth/google/callback", "/api/health", "/api/coach/demo", "/api/gym-demo/ai", "/api/client-error", "/api/csp-report", "/api/webhooks/razorpay", "/api/trainer/auth/link", "/api/coach", "/api/assistant", "/iclock/cdata", "/site/fitron-3d.js", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/ai-personal-trainer", "/guides", "/guides/gst-on-gym-membership", ...GYM_PAGES.map((p) => p.path)])(
    "%s",
    (p) => expect(isPublicPath(p)).toBe(true),
  );

  it.each(["/dashboard", "/members", "/members/abc", "/settings/billing", "/invoices/new", "/api/ai/chat", "/plan-ended", "/contacts", "/loginx", "/trainers", "/checkin", "/cx/y"])("is closed for %s", (p) => expect(isPublicPath(p)).toBe(false));

  it("includes every folder of src/app/(site) that has a page", () => {
    const site = path.join(__dirname, "app/(site)");
    const pages = readdirSync(site, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(path.join(site, e.name, "page.tsx"))).map((e) => `/${e.name}`);
    expect(pages.length).toBeGreaterThan(8);
    expect(pages.filter((p) => !isPublicPath(p))).toEqual([]);
  });

  it("includes everything the matcher leaves alone: those paths are public by design", () => {
    const left = config.matcher[0]!.match(/\(\?!([^)]*)\)/)![1]!.split("|").map((x) => x.replace(/\/$/, ""));
    expect(left.length).toBeGreaterThan(10);
    expect(left.filter((x) => !isPublicPath(`/${x}`) && !isPublicPath(`/${x}/f`))).toEqual([]);
  });
});

describe("which paths the proxy runs for", () => {
  it.each(["/", "/login", "/signin", "/trainer", "/contact", "/gym-accounting", "/dashboard", "/members/abc", "/api/ai/chat"])("runs for %s, which needs a policy or a session", (p) => expect(runs(p)).toBe(true));
  it.each(["/_next/static/x.js", "/site/index.html", "/trainer/sw.js", "/trainer/support.js", "/iclock/cdata", "/api/webhooks/razorpay", "/api/jobs/run", "/api/health", "/api/trainer/auth/link", "/api/coach", "/api/coach/demo", "/api/gym-demo/ai", "/api/assistant", "/api/csp-report", "/api/client-error", "/auth/google/start", "/robots.txt", "/sitemap.xml", "/favicon.ico"])(
    "does not run for %s",
    (p) => expect(runs(p)).toBe(false),
  );
});

describe("the sign-in check", () => {
  it("sends a visitor without a session from a console page to sign-in, remembering where they were going", () => {
    const r = visit("/members/abc?tab=notes");
    expect(r.status).toBe(307);
    const to = new URL(r.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("/members/abc?tab=notes");
  });

  it("lets a visitor without a session open public pages", () => {
    for (const p of ["/", "/contact", "/gym-accounting", "/trainer", "/login"]) expect(visit(p).status, p).toBe(200);
  });

  it("lets a visitor with a session cookie into the console", () => {
    expect(visit("/dashboard", true).status).toBe(200);
  });
});

describe("an address that is not a page", () => {
  it("is left to answer 404 for a stranger, instead of being sent to the sign-in", () => {
    for (const p of ["/anything-wrong", "/gym-accounting-software-old", "/blog/some-article", "/this/is/not/a/page", "/apple-icon.png", "/icon.png"]) {
      const r = visit(p);
      expect(r.status, p).toBe(200); // the proxy lets it through; Next.js then answers 404
      expect(r.headers.get("location"), p).toBeNull();
      expect(isGuardedPath(p), p).toBe(false);
    }
  });

  it("still sends a stranger who asks for a console page or a private API route to the sign-in", () => {
    for (const p of ["/dashboard", "/members/abc", "/settings/billing", "/invoices/new", "/onboarding", "/plan-ended", "/documents/abc", "/api/ai/chat", "/api/search", "/api/unknown"]) {
      const r = visit(p);
      expect(r.status, p).toBe(307);
      expect(new URL(r.headers.get("location")!).pathname, p).toBe("/login");
    }
  });

  it("knows every folder of the console: a page added without listing it would stop being protected by the sign-in redirect", () => {
    const app = path.join(__dirname, "app");
    const folders = (dir: string) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    const consoleFolders = folders(path.join(app, "(app)"));
    expect(consoleFolders.length).toBeGreaterThan(20);
    expect(consoleFolders.filter((f) => !(CONSOLE_SEGMENTS as readonly string[]).includes(f))).toEqual([]);
    // Every other top-level folder of src/app is public, the console's, the API, or a route group.
    const others = folders(app).filter((f) => !f.startsWith("(") && f !== "api");
    expect(others.filter((f) => !isPublicPath(`/${f}`) && !(CONSOLE_SEGMENTS as readonly string[]).includes(f))).toEqual([]);
    // And every segment listed is a real folder (a rename would otherwise leave the old name behind).
    const real = new Set([...consoleFolders, ...folders(app)]);
    expect((CONSOLE_SEGMENTS as readonly string[]).filter((c) => !real.has(c))).toEqual([]);
    // Every private API folder is guarded.
    for (const f of folders(path.join(app, "api"))) {
      const p = `/api/${f}/x`;
      expect(isPublicPath(p) || isGuardedPath(p), p).toBe(true);
    }
  });
});

describe("the Content-Security-Policy it sends", () => {
  const header = (r: Response, name = "Content-Security-Policy-Report-Only") => r.headers.get(name) ?? "";

  it("is, by default, report-only: it reports what it would block and blocks nothing", () => {
    const r = visit("/dashboard", true);
    expect(header(r)).toContain("script-src");
    expect(r.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("blocks when CSP_MODE is enforce, and sends nothing when it is off", () => {
    vi.stubEnv("CSP_MODE", "enforce");
    const r = visit("/dashboard", true);
    expect(header(r, "Content-Security-Policy")).toContain("script-src");
    expect(r.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    vi.stubEnv("CSP_MODE", "off");
    const off = visit("/dashboard", true);
    expect(off.headers.get("Content-Security-Policy")).toBeNull();
    expect(off.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("gives the console a new nonce on every request, and tells Next.js which one", () => {
    const a = visit("/dashboard", true);
    const b = visit("/dashboard", true);
    const nonce = (r: Response) => header(r).match(/'nonce-([A-Za-z0-9+/=_-]+)'/)?.[1];
    expect(nonce(a)).toBeTruthy();
    expect(nonce(a)).not.toBe(nonce(b));
    // Next.js reads the nonce from the request's copy of the header, which NextResponse.next passes on this way.
    expect(a.headers.get("x-middleware-request-content-security-policy-report-only")).toBe(header(a));
  });

  it("uses the console's policy only behind the sign-in, the trainer's for /trainer, and the website's for the rest", () => {
    const script = (p: string, c = false) => header(visit(p, c)).match(/script-src ([^;]*)/)![1]!;
    expect(script("/dashboard", true)).toContain("'strict-dynamic'");
    expect(script("/dashboard", true)).not.toContain("'unsafe-inline'");
    expect(script("/trainer")).toContain("'unsafe-eval'");
    expect(script("/")).toContain("'unsafe-inline'");
    expect(script("/")).not.toContain("'unsafe-eval'");
    expect(script("/login")).toBe(script("/gym-accounting"));
  });

  it("sends nothing on a redirect to sign-in", () => {
    const r = visit("/dashboard");
    expect(r.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });
});
