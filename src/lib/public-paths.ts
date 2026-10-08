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
  "contact", "about", "privacy", "terms", "refund", "c",
  "robots.txt", "sitemap.xml", "favicon.ico", "fitron-mark.png", "fitron-logo.png", "site", "_next",
  "trainer", "api/trainer", "api/coach", "api/gym-demo", "api/assistant",
  "api/health", "api/analytics-config", "api/client-error", "api/csp-report", "api/webhooks", "api/jobs", "iclock",
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
