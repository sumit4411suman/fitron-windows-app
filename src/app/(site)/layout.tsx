import { preload } from "react-dom";
import { SiteAnalytics, SiteConsent } from "./site-consent";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import "./site.css";

// Public pages of fitron.in that sit next to the static home page (which has its own copy of the header and footer).
// The home page is a static file, so links to it are plain <a>, not <Link>.

// The two fonts every public page's text and headings need (Plus Jakarta Sans and Oswald, latin), asked for with the HTML
// rather than after the stylesheet has been read.
const FONTS = ["/site/fonts/94fe6a0f-92d6-4207-b31a-5f1996480dd1.woff2", "/site/fonts/b6fcac0c-a35e-4fc6-acbf-0ae1df9e3d45.woff2", "/site/fonts/4632733b-b063-4bbf-a396-0e31b80c17fa.woff2"];

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  for (const href of FONTS) preload(href, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <div className="site-ui flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top_left,var(--accent-soft),transparent_55%)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-accent-ink">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-20 sm:pt-12">
        {children}
      </main>
      <SiteFooter />
      <SiteConsent />
      <SiteAnalytics />
    </div>
  );
}
