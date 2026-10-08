# SEO for fitron.in

No one can promise first place on Google. Rankings depend on how many trusted sites link to you, how long the domain has existed, how well each page answers the search, and what competitors do. This file covers what the code already does (on-page) and the work that happens outside the code (off-page), in the order that pays off soonest.

## On-page: what the site already does

| What | Where |
| --- | --- |
| A title, description, canonical URL and Open Graph/Twitter preview on every public page | `src/lib/seo.ts` (`pageMetadata`), home page `<head>` |
| Public pages are `index, follow` with large image previews. Console, sign-in and member pages are `noindex` | `pageMetadata` and the root layout `src/app/layout.tsx` |
| `robots.txt` lets crawlers in on the website and keeps them out of the console | `src/app/robots.ts` |
| `sitemap.xml` lists every public page | `src/app/sitemap.ts` |
| Structured data: Organization, WebSite, SoftwareApplication with prices, FAQPage and BreadcrumbList | home page (`scripts/site_patches.py`), `gym-page.tsx`, `ai-personal-trainer/page.tsx` |
| One landing page for each search intent | `/gym-accounting`, `/gym-management-software`, `/gym-gst-billing`, `/ai-personal-trainer` |
| Guides that answer gym owners' questions and link to the product pages (Article + FAQ structured data) | `/guides` (content in `src/lib/domain/guides.ts`) |
| Internal links: the header and footer of every public page link to every product page, and the home page links to all of them | `src/app/(site)/layout.tsx`, `scripts/site_patches.py` |
| Web app manifest | `src/app/manifest.ts` |
| `lang="en-IN"`, one `<h1>` per page, alt text on images, cached static assets | layouts, `next.config.ts` |

When you add a public page, call `pageMetadata` (if you leave it out, the page stays `noindex`). Add the page to `sitemap.ts`, `robots.ts` (allow) and `src/lib/public-paths.ts`, and link to it from the site footer.

## Plan for "gym accounting software"

Look at that search today. Google's AI Overview and the panel next to it quote **articles**: "top gym accounting software" lists and explainers (BUSY, VJM Global, Gymdesk). Every tool those articles name gets a mention and a link. To get into the top results you need three things:

1. **Be indexed and trusted.** Search Console is set up, the sitemap is submitted, and every page in it shows as "Indexed". Until this is true, nothing else counts.
2. **Be named in the articles Google already trusts.** Write to the authors of every "best / top gym accounting software (India)" and "gym management software India" article on the first two pages of results. Ask them to review FITRON, and offer a free account and screenshots. Get listed in the "gym management software" category on SoftwareSuggest, Techjockey, Capterra and G2. Those category pages rank for this search themselves, and their reviews feed the AI Overview.
3. **Answer the whole topic on fitron.in.** `/gym-accounting` is the page meant to rank. The guides cover the questions around it (GST, profit and loss, moving from a register) and link to it with the words "gym accounting software". Add a new guide every month or two, for example on gym expense categories, trainer commission and payroll, or renewals and dues follow-up.

Start with the long-tail searches you can win sooner: "gym accounting software India", "gym GST billing software", "gym fee management software". Then the head term follows. For a new domain this usually takes 3 to 6 months of steady links and content. Nothing in the code can force a position, and anyone who promises "#1 in a week" is selling something Google penalises.

## Off-page: do these once

1. **Google Search Console.** Add a *Domain* property for `fitron.in` and verify it with the DNS TXT record (this covers `www` and every path, including the static home page). Submit `https://fitron.in/sitemap.xml`. Use *URL Inspection → Request indexing* on `/`, `/gym-accounting`, `/gym-management-software`, `/gym-gst-billing` and `/ai-personal-trainer`.
2. **Bing Webmaster Tools.** Use *Import from Google Search Console*. Bing results also power DuckDuckGo, Yahoo and ChatGPT search. Submit the sitemap there too.
3. **Google Business Profile.** Create a profile for FITRON (a service-area business in India) with the website, phone `+91 62077 74673`, the category "Software company", photos and the same business name, address and phone (NAP) used everywhere else. Ask your first gyms for reviews there.
4. **Pick one host.** Make sure `www.fitron.in` permanently redirects (301) to `https://fitron.in` at the domain or hosting level, so links are not split between two hosts.
5. **Social profiles.** Create LinkedIn, Instagram, YouTube, Facebook and X pages named "FITRON" that link to `https://fitron.in`. Then add their URLs as `sameAs` on the Organization in `scripts/site_patches.py` (`structured_data`) so Google ties them to the brand.

## Off-page: links and mentions (ongoing)

Links from relevant, trusted sites are the strongest ranking factor you control. Aim for a few good ones each month. Don't buy links in bulk: Google penalises it.

- **Software directories (India and global).** List both products on Capterra, G2, GetApp, Software Advice, SoftwareSuggest, Techjockey, SaaSworthy, Product Hunt and AlternativeTo. Ask happy gyms to leave a review on each.
- **Fitness and gym-owner communities.** Gym-owner associations, franchise networks, equipment dealers (ZKTeco and eSSL resellers can list FITRON as compatible software), and Facebook or WhatsApp groups for gym owners. Partner gyms can add a "Powered by FITRON" link on their own website.
- **Content that earns links.** Write helpful guides that people want to share and that target real searches. For example: "GST on gym membership in India", "How to calculate gym profit and loss", "Gym membership fee register template (Excel)", "Indian diet plan for muscle gain (veg)", "Home workout plan with dumbbells". Publish them on fitron.in, then share them on LinkedIn, Quora, Reddit (r/IndianFitness, r/india_startups) and in communities.
- **PR.** Startup launch posts (YourStory, Inc42, local news), founder interviews and podcasts about fitness business in India.
- **Accountants.** CA firms that serve gyms can link to `/gym-gst-billing` as a tool for their clients.

## Measure

- Search Console → *Performance*: watch impressions, clicks and average position for queries like "gym accounting software", "gym management software India", "gym GST invoice" and "AI personal trainer app India".
- Search Console → *Pages*: every page in the sitemap should be "Indexed". Fix anything listed as excluded.
- PageSpeed Insights on `/` and each landing page: keep Core Web Vitals green on mobile.
- Review every quarter: rewrite the titles and descriptions of pages that get impressions but few clicks.
