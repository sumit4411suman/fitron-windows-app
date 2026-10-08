import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCsp, cspHeaderName, cspMode, THEME_SCRIPT_SOURCE, type CspTier } from "./csp";
import { THEME_SCRIPT } from "./theme-script";

const root = path.join(__dirname, "../..");
const directives = (p: string) => Object.fromEntries(p.split("; ").map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)]));
const policy = (tier: CspTier, over: { dev?: boolean } = {}) => directives(buildCsp({ tier, nonce: tier === "app" ? "TESTNONCE" : undefined, ...over }));

describe("every policy", () => {
  it.each(["app", "site", "trainer"] as const)("%s: allows no plugins, no other base address, no framing by others, and reports to us", (t) => {
    const p = policy(t);
    expect(p["object-src"]).toEqual(["'none'"]);
    expect(p["base-uri"]).toEqual(["'self'"]);
    expect(p["frame-ancestors"]).toEqual(["'none'"]);
    expect(p["default-src"]).toEqual(["'self'"]);
    expect(p["report-uri"]).toEqual(["/api/csp-report"]);
    expect(p["form-action"]).toEqual(["'self'", "https://accounts.google.com"]);
  });

  it.each(["app", "site", "trainer"] as const)("%s: lets scripts come from nowhere but ourselves, apart from Razorpay where plans are paid for (and, in the console, Meta's WhatsApp Connect pop-up)", (t) => {
    const hosts = policy(t)["script-src"]!.filter((s) => /^https?:|\*/.test(s));
    expect(hosts).toEqual(t === "site" ? [] : t === "app" ? ["https://checkout.razorpay.com", "https://connect.facebook.net"] : ["https://checkout.razorpay.com"]);
  });

  it.each(["app", "site", "trainer"] as const)("%s: only the allowed hosts can be connected to or framed, and never a bare wildcard", (t) => {
    const p = policy(t);
    for (const d of ["script-src", "connect-src", "frame-src", "style-src", "font-src"]) expect(p[d], d).not.toContain("*");
    expect(p["connect-src"]!.filter((s) => s.startsWith("http"))).toEqual(t === "site" ? [] : t === "app" ? ["https://*.razorpay.com", "https://www.facebook.com", "https://web.facebook.com"] : ["https://*.razorpay.com"]);
  });

  it("is a single line a header can carry", () => {
    for (const t of ["app", "site", "trainer"] as const) expect(buildCsp({ tier: t, nonce: "n" })).not.toMatch(/[\r\n]/);
  });
});

describe("the console's policy", () => {
  const p = policy("app");

  it("runs only scripts with this request's nonce (and the ones they load), and the theme script by its hash", () => {
    expect(p["script-src"]).toEqual(["'self'", "'nonce-TESTNONCE'", THEME_SCRIPT_SOURCE, "'strict-dynamic'", "https://checkout.razorpay.com", "https://connect.facebook.net"]);
    expect(p["script-src"]).not.toContain("'unsafe-inline'");
    expect(p["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("needs a nonce", () => {
    expect(() => buildCsp({ tier: "app" })).toThrow(/nonce/);
  });

  it("opens Razorpay's checkout and Meta's WhatsApp Connect pop-up, and nothing else to connect to or show", () => {
    expect(p["frame-src"]).toEqual(["https://*.razorpay.com", "https://www.facebook.com", "https://web.facebook.com"]);
    expect(p["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(p["font-src"]).toEqual(["'self'"]);
  });

  it("allows eval and websockets only when developing", () => {
    expect(policy("app", { dev: true })["script-src"]).toContain("'unsafe-eval'");
    expect(policy("app", { dev: true })["connect-src"]).toContain("ws:");
    expect(p["connect-src"]).not.toContain("ws:");
  });
});

describe("the website's and the trainer's policies", () => {
  it("allow inline scripts, since their pages are static files, but eval only in the trainer, which compiles its components in the browser", () => {
    expect(policy("site")["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy("trainer")["script-src"]).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://checkout.razorpay.com"]);
  });

  it("let only the trainer use Google Fonts and show YouTube videos", () => {
    expect(policy("trainer")["style-src"]).toContain("https://fonts.googleapis.com");
    expect(policy("trainer")["font-src"]).toContain("https://fonts.gstatic.com");
    // Razorpay's checkout frame is the one other thing it may show, for paying for a plan.
    expect(policy("trainer")["frame-src"]).toEqual(["'self'", "https://www.youtube-nocookie.com", "https://www.youtube.com", "https://*.razorpay.com"]);
    expect(policy("site")["style-src"]).not.toContain("https://fonts.googleapis.com");
    // The website frames only its own Gym Accounting live demo.
    expect(policy("site")["frame-src"]).toEqual(["'self'"]);
  });
});

describe("the theme script", () => {
  it("is allowed by its own hash, which follows the script", () => {
    expect(THEME_SCRIPT_SOURCE).toBe(`'sha256-${createHash("sha256").update(THEME_SCRIPT).digest("base64")}'`);
  });

  it("is the one the root layout writes into the page", () => {
    const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('import { THEME_SCRIPT } from "@/lib/theme-script"');
    expect(layout).toContain("__html: THEME_SCRIPT");
    expect(layout.includes("localStorage"), "the layout must not carry its own copy").toBe(false);
  });
});

describe("mode", () => {
  it("is report-only unless told otherwise, and off while developing", () => {
    expect(cspMode({})).toBe("report");
    expect(cspMode({ NODE_ENV: "production" })).toBe("report");
    expect(cspMode({ NODE_ENV: "development" })).toBe("off");
  });

  it("follows CSP_MODE, and falls back to report-only for anything it does not know", () => {
    expect(cspMode({ CSP_MODE: "enforce" })).toBe("enforce");
    expect(cspMode({ CSP_MODE: " Enforce " })).toBe("enforce");
    expect(cspMode({ CSP_MODE: "off" })).toBe("off");
    expect(cspMode({ CSP_MODE: "block" })).toBe("report");
    expect(cspMode({ CSP_MODE: "enforce", NODE_ENV: "development" })).toBe("enforce");
  });

  it("names the header for each mode", () => {
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
    expect(cspHeaderName("report")).toBe("Content-Security-Policy-Report-Only");
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (n === "generated" || n === "node_modules") return [];
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe("zod", () => {
  it("is switched off from compiling with `new Function` wherever a schema is defined, since the policy reports every try", () => {
    const bad = sourceFiles(path.join(root, "src"))
      .filter((f) => !f.endsWith("zod-config.ts"))
      .filter((f) => {
        const s = readFileSync(f, "utf8");
        return /from "zod"/.test(s) && !s.includes('import "@/lib/zod-config"');
      })
      .map((f) => path.relative(root, f));
    expect(bad).toEqual([]);
    expect(readFileSync(path.join(root, "src/lib/zod-config.ts"), "utf8")).toContain("z.config({ jitless: true })");
  });

describe("Google Analytics", () => {
  it("is not allowed anywhere unless a measurement ID is set", () => {
    for (const t of ["app", "site", "trainer"] as const) expect(buildCsp({ tier: t, nonce: "n", analytics: false })).not.toMatch(/googletagmanager|google-analytics|analytics\.google/);
  });

  it("is allowed for the public website only, never for the console or the AI Trainer", () => {
    expect(buildCsp({ tier: "site", analytics: true })).toContain("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com");
    expect(buildCsp({ tier: "site", analytics: true })).toContain("https://*.google-analytics.com");
    for (const t of ["app", "trainer"] as const) expect(buildCsp({ tier: t, nonce: "n", analytics: true })).not.toMatch(/googletagmanager|google-analytics/);
  });
});
});
