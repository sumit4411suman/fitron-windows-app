import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, cspHeaderName, cspMode, type CspTier } from "@/lib/csp";
import { isGuardedPath } from "@/lib/public-paths";

// Runs before every page. Two jobs:
//  1. Optimistic check only: send visitors without a session cookie to sign-in when they ask for a console page or a
//     private API route. Real checks happen on the server in every page and action. An address that is neither public
//     nor the console's is not a page, and is let through to answer 404.
//  2. Send the Content-Security-Policy for the page (src/lib/csp.ts). The console's gets a new nonce on every request;
//     Next.js reads it from the request header set here and puts it on its own scripts.
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const guarded = isGuardedPath(pathname);
  if (guarded && !req.cookies.has("fitron_session")) {
    // Come back to the page they wanted after logging in.
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  const mode = cspMode();
  if (mode === "off") return NextResponse.next();
  const tier: CspTier = guarded ? "app" : pathname === "/trainer" ? "trainer" : "site";
  const policy = buildCsp({ tier, nonce: tier === "app" ? btoa(crypto.randomUUID()) : undefined, dev: process.env.NODE_ENV === "development" });
  const name = cspHeaderName(mode);
  const headers = new Headers(req.headers);
  headers.set(name, policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(name, policy);
  return res;
}

export const config = {
  // Everything except what has nothing to protect or needs no policy: Next.js and the public pages' own files, robots and
  // sitemap, and the machine routes (health check, webhooks, job runner, door devices, the AI Trainer's APIs, error and
  // violation reports). They are public: src/lib/public-paths.ts, kept equal to this list by proxy.test.ts.
  matcher: ["/((?!_next/|site/|trainer/|auth/|iclock/|api/webhooks/|api/jobs/|api/trainer/|api/coach|api/gym-demo|api/assistant|api/health|api/analytics-config|api/client-error|api/csp-report|robots.txt|sitemap.xml|manifest.webmanifest|favicon.ico|fitron-mark.png|fitron-logo.png).*)"],
};
