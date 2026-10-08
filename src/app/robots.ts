import type { MetadataRoute } from "next";
import { GYM_PAGES } from "@/lib/domain/gym-pages";
import { GUIDES_PATH } from "@/lib/domain/guides";
import { TOOLS_PATH } from "@/lib/domain/tools";
import { TRAINER_PAGE } from "@/lib/domain/trainer-page";

// The console paths a crawler could find in a link but must not index. Everything else under "/" is allowed; the
// console's own pages also carry a noindex (the root layout), which covers the ones not listed here.
const PRIVATE = ["/api/", "/auth/", "/login", "/signin", "/signup", "/onboarding", "/plan-ended", "/verify-email", "/forgot-password", "/reset-password", "/dashboard", "/documents/", "/iclock/", "/c/"];

export default function robots(): MetadataRoute.Robots {
  return {
    // Only the public website is indexed; the console and APIs are private.
    rules: { userAgent: "*", allow: ["/", ...GYM_PAGES.map((p) => p.path), TRAINER_PAGE.path, GUIDES_PATH, TOOLS_PATH, "/trainer", "/about", "/contact", "/privacy", "/terms", "/refund"], disallow: PRIVATE },
    sitemap: "https://fitron.in/sitemap.xml",
    host: "https://fitron.in",
  };
}
