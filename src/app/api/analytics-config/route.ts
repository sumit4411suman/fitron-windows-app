import { analyticsId } from "@/lib/analytics";

// The Google Analytics measurement ID for the public pages (public/site/analytics.js asks for it once the visitor has
// agreed to analytics). It is not secret, but it lives in the server's settings, not in the page files, so a deployment
// without GA_MEASUREMENT_ID loads no analytics at all. The same value opens the Content-Security-Policy to Google's
// scripts (src/lib/csp.ts).
export function GET() {
  return Response.json({ id: analyticsId() }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
