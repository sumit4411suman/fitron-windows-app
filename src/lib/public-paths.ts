import { GYM_PAGES } from "@/lib/domain/gym-pages";
import { GUIDES_PATH } from "@/lib/domain/guides";
import { TOOLS_PATH } from "@/lib/domain/tools";
import { TRAINER_PAGE } from "@/lib/domain/trainer-page";

// The paths that anyone can open without a session (src/proxy.ts sends every other path to the sign-in): the website,
// the sign-in and sign-up pages, links from emails, the member check-in page the front-desk QR poster opens (/c/…), the AI
// Trainer member app and its APIs, webhooks, the job runner and door devices (which authenticate with their own
// signatures and secrets), and the files of the public pages.
// A path matches by whole segments: "/contact" and "/contact/x", not "/contacts".
const PUBLIC = [
  "auth", "login", "signin", "signup", "verify-email", "forgot-password", "reset-password",
  // The Local Edition's first-run setup and owner recovery (they answer 404 on the Cloud Edition).
  "setup", "recover", "recovery",
  "contact", "about", "privacy", "terms", "refund", "c",
  "robots.txt", "sitemap.xml", "favicon.ico", "fitron-mark.png", "fitron-mark-v2.png", "fitron-mark-light-v2.png", "fitron-logo.png", "fitron-logo-v2.png", "site", "_next",
  "trainer", "api/trainer", "api/coach", "api/gym-demo", "api/assistant",
  // fitron.in: buying a FITRON for Windows licence, and the computer collecting it (src/lib/services/windows-licence.ts),
  // and the link to its newest installer (src/app/download/windows).
  "windows", "api/windows-licence", "api/windows-ai", "download",
  "api/health", "api/local/shell", "api/sync", "api/analytics-config", "api/client-error", "api/csp-report", "api/webhooks", "api/jobs", "iclock",
  // The pages about Gym Accounting (src/lib/domain/gym-pages.ts) join this list by themselves.
  ...GYM_PAGES.map((p) => p.path.slice(1)),
  TRAINER_PAGE.path.slice(1), GUIDES_PATH.slice(1), TOOLS_PATH.slice(1), "manifest.webmanifest",
];

// The first segments of the signed-in console's own addresses: every folder of src/app/(app), and the pages outside it that
// need a session. src/proxy.ts sends a visitor without a session who asks for one of these (or for any /api/ path that is not
// public) to the sign-in. Any other address that is not public is not a page at all, so it is left to answer 404 like any
// wrong address, for a stranger and a search engine as for anyone. proxy.test.ts fails if a console folder is missing here.
export const CONSOLE_SEGMENTS = [
  "accounting", "ai", "assets", "attendance", "audit", "autopay", "classes", "dashboard", "expenses", "fitron-admin", "invoices", "leads",
  "members", "notifications", "partnership", "payments", "plans", "pos", "products", "profile", "programs", "purchases", "receivables",
  "renewals", "reports", "settings", "staff", "whatsapp",
  "onboarding", "plan-ended", "documents",
] as const;

/** An address that belongs behind the sign-in: the console's pages and every API route that is not public. */
export function isGuardedPath(pathname: string): boolean {
  if (isPublicPath(pathname)) return false;
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  const first = pathname.split("/")[1] ?? "";
  return (CONSOLE_SEGMENTS as readonly string[]).includes(first);
}

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC.some((p) => pathname === `/${p}` || pathname.startsWith(`/${p}/`));
}

/**
 * Sign-in routes that need the internet and a fitron.in account (Google, emailed links and codes, website sign-up).
 * The Local Edition sends them to its own sign-in instead (src/proxy.ts).
 */
export const ONLINE_ONLY_AUTH = ["signup", "signin", "forgot-password", "reset-password", "verify-email", "auth", "login/email"] as const;

export function isOnlineOnlyAuthPath(pathname: string): boolean {
  return ONLINE_ONLY_AUTH.some((p) => pathname === `/${p}` || pathname.startsWith(`/${p}/`));
}

/**
 * What is not part of FITRON Gym Accounting for Windows: the fitron.in website and its APIs, the AI Trainer, the FITRON
 * team console, FITRON's own plan billing, the Gym Partnership, webhooks from online services, and the front-desk QR page
 * (it needs the gym's network to reach this computer). Door devices are not answered here either: they reach FITRON for
 * Windows on its own device port, once turned on (src/lib/integrations/door-devices). On the Local Edition these
 * addresses lead to the console instead (src/proxy.ts). Matched by whole segments.
 */
export const NOT_IN_LOCAL = [
  "site", "contact", "about", "privacy", "terms", "refund", "guides", "tools", "trainer", "c", "plan-ended", "partnership",
  "fitron-admin", "settings/billing", "windows", "download", "api/windows-licence", "api/windows-ai", "api/trainer", "api/coach", "api/gym-demo", "api/assistant", "api/webhooks", "api/analytics-config", "iclock",
  // The server scheduler's job addresses: FITRON for Windows runs its own jobs in-process (src/lib/runtime/local-scheduler.ts).
  "api/jobs",
  ...GYM_PAGES.map((p) => p.path.slice(1)), TRAINER_PAGE.path.slice(1), "robots.txt", "sitemap.xml",
] as const;

export function isNotInLocal(pathname: string): boolean {
  if (pathname === "/") return true;
  return NOT_IN_LOCAL.some((p) => pathname === `/${p}` || pathname.startsWith(`/${p}/`));
}
