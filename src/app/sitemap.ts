import type { MetadataRoute } from "next";
import { GYM_ACCOUNTING, GYM_PAGES } from "@/lib/domain/gym-pages";
import { GUIDES, GUIDES_PATH, guidePath } from "@/lib/domain/guides";
import { TOOLS, TOOLS_PATH, toolPath } from "@/lib/domain/tools";
import { TRAINER_PAGE } from "@/lib/domain/trainer-page";

const base = "https://fitron.in";

// No lastModified: it was a date typed in by hand, and a wrong date is worse than none. /signup is left out
// because each of its plans now opens its own product's sign-in (/login or /trainer).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    // The pages about Gym Accounting, with the main one first.
    ...GYM_PAGES.map((p) => ({ url: `${base}${p.path}`, changeFrequency: "monthly" as const, priority: p.path === GYM_ACCOUNTING.path ? 0.9 : 0.8 })),
    { url: `${base}${TRAINER_PAGE.path}`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}${GUIDES_PATH}`, changeFrequency: "monthly", priority: 0.7 },
    ...GUIDES.map((g) => ({ url: `${base}${guidePath(g)}`, changeFrequency: "monthly" as const, priority: 0.7 })),
    { url: `${base}${TOOLS_PATH}`, changeFrequency: "monthly", priority: 0.7 },
    ...TOOLS.map((t) => ({ url: `${base}${toolPath(t)}`, changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: `${base}/about`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/refund`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
