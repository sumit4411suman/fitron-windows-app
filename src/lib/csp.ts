import { createHash } from "node:crypto";
import { analyticsId } from "@/lib/analytics";
import { THEME_SCRIPT } from "@/lib/theme-script";

// The Content-Security-Policy sent with every page (src/proxy.ts): what the browser may load and run on it, so that a
// script an attacker manages to put in a page is not run and cannot send data elsewhere.
//
// There are three policies, by what a page is:
//  - "app": the signed-in console. Rendered per request, so each response gets a fresh nonce and only scripts carrying
//    it (and the ones they load) run. No 'unsafe-inline' for scripts.
//  - "site": the website and the sign-in pages. These are static files or prerendered pages, which cannot carry a
//    per-request nonce, so inline scripts must be allowed. Everything else (where data can be sent, what can be framed,
//    plugins, the base address) is still restricted.
//  - "trainer": the AI Trainer member app, a static page that compiles its own components in the browser, so it also
//    needs 'unsafe-eval', and it loads Google Fonts. Members pay for their plan in Razorpay's checkout, so, like the
//    console, it may load checkout.razorpay.com and open Razorpay's frame.
// Mode (CSP_MODE): "report" (the default) only reports what would be blocked, to /api/csp-report; "enforce" blocks it;
// "off" sends nothing.

export type CspMode = "off" | "report" | "enforce";
export type CspTier = "app" | "site" | "trainer";

export function cspMode(env: Record<string, string | undefined> = process.env): CspMode {
  const v = env.CSP_MODE?.trim().toLowerCase();
  if (v === "off" || v === "report" || v === "enforce") return v;
  return env.NODE_ENV === "development" ? "off" : "report";
}

export const cspHeaderName = (mode: "report" | "enforce") => (mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only");

/** The hash that lets the one inline script of the root layout (the theme choice) run under the "app" policy. */
export const THEME_SCRIPT_SOURCE = `'sha256-${createHash("sha256").update(THEME_SCRIPT).digest("base64")}'`;

const RAZORPAY = "https://*.razorpay.com"; // checkout.js, its frame, and its own requests
const YOUTUBE = ["https://www.youtube-nocookie.com", "https://www.youtube.com"]; // exercise videos in the AI Trainer
const META_SDK = "https://connect.facebook.net"; // the WhatsApp "Connect" pop-up (Embedded Signup) in Settings › WhatsApp
const META = ["https://www.facebook.com", "https://web.facebook.com"];
const GOOGLE = "https://accounts.google.com"; // "Continue with Google" is a redirect that a form can start

// Google Analytics (only when GA_MEASUREMENT_ID is set, and only for the public website: the console and the AI Trainer
// load no analytics). Its script comes from googletagmanager.com and it reports to google-analytics.com.
const GA_SCRIPT = "https://www.googletagmanager.com";
const GA_CONNECT = ["https://www.googletagmanager.com", "https://*.google-analytics.com", "https://*.analytics.google.com"];

export function buildCsp({ tier, nonce, dev = false, analytics = analyticsId() !== null }: { tier: CspTier; nonce?: string; dev?: boolean; analytics?: boolean }): string {
  const d: Record<string, string[]> = {
    "default-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", GOOGLE],
    "frame-ancestors": ["'none'"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
  };
  if (tier === "app") {
    if (!nonce) throw new Error("The console's policy needs a nonce");
    // 'strict-dynamic': scripts that a nonced script loads (Next.js chunks, Razorpay checkout) may run; the host list
    // after it is for old browsers that do not know it. Styles keep 'unsafe-inline' for the style="" attributes React writes.
    d["script-src"] = ["'self'", `'nonce-${nonce}'`, THEME_SCRIPT_SOURCE, "'strict-dynamic'", "https://checkout.razorpay.com", META_SDK, ...(dev ? ["'unsafe-eval'"] : [])];
    d["style-src"] = ["'self'", "'unsafe-inline'"];
    d["img-src"] = ["'self'", "data:", "blob:"];
    d["font-src"] = ["'self'"];
    d["connect-src"] = ["'self'", RAZORPAY, ...META, ...(dev ? ["ws:", "wss:"] : [])];
    d["frame-src"] = [RAZORPAY, ...META];
    d["media-src"] = ["'self'", "blob:"];
  } else {
    const ga = analytics && tier === "site";
    d["script-src"] = ["'self'", "'unsafe-inline'", ...(tier === "trainer" ? ["'unsafe-eval'", "https://checkout.razorpay.com"] : []), ...(ga ? [GA_SCRIPT] : []), ...(dev ? ["'unsafe-eval'"] : [])];
    d["style-src"] = ["'self'", "'unsafe-inline'", ...(tier === "trainer" ? ["https://fonts.googleapis.com"] : [])];
    d["img-src"] = ["'self'", "data:", "blob:", "https:"];
    d["font-src"] = ["'self'", "data:", ...(tier === "trainer" ? ["https://fonts.gstatic.com"] : [])];
    d["connect-src"] = ["'self'", ...(tier === "trainer" ? [RAZORPAY] : []), ...(ga ? GA_CONNECT : []), ...(dev ? ["ws:", "wss:"] : [])];
    // The trainer's page has an iframe whose address is a {{placeholder}} until its template fills it in, which the browser
    // first tries as a same-origin address (our own X-Frame-Options refuses it); 'self' keeps that out of the reports.
    // The website shows the Gym Accounting, AI Coach and Partner Console live demos (public/site/gym-demo.html, coach-demo.html,
    // partner-demo.html) in frames on the home page.
    d["frame-src"] = tier === "trainer" ? ["'self'", ...YOUTUBE, RAZORPAY] : ["'self'"];
    d["media-src"] = ["'self'", "blob:", ...(tier === "trainer" ? ["https:"] : [])];
  }
  d["report-uri"] = ["/api/csp-report"];
  return Object.entries(d)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}
