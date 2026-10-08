# Growing fitron.in: content, links and trust

What follows is the plan for the work that code cannot do, written to fit what the site is today. `deploy/SEO.md` lists what
is built in and the one-off setup steps (Search Console, Bing); `docs/ANALYTICS.md` lists the tracked events.

The rules for everything below: no bought links, no link networks, no automated spam, no fake profiles, reviews, ratings,
testimonials or statistics. Every claim on a page must be one the product can back (`npm test` checks the main ones).

## Content (on-site)

The architecture already exists: `/guides` and `/guides/[slug]`, written in `src/lib/domain/guides.ts` and listed in the
sitemap. Keep using it rather than adding a second `/blog`: two sections for the same kind of article split links and
confuse readers. If you ever want a news-style blog, give it its own path then.

Write each article for one search, with a named author, a "last updated" date, and a link to the product page it belongs to.
Three clusters, each with a pillar page and supporting guides:

| Pillar | Supporting guides |
| --- | --- |
| Gym management software | gym membership software; gym billing; gym fee management; gym attendance; gym expense tracking; gym P&L; gym GST billing; gym payroll |
| Gym business | how to calculate gym profit; reduce member churn; manage expenses; manage several branches; automate payment reminders; move from Excel to gym software |
| AI personal trainer | what is an AI personal trainer; AI vs human trainer; how AI workout plans work; a beginner workout plan; Indian meal planning; tracking protein; staying consistent |

Location pages (Delhi, Mumbai, Bengaluru, Ranchi, Jamshedpur, Chandigarh…) only if each has something true and local to say,
such as how the city's gyms bill or which GST questions come up. Never a template with the city name swapped.

## Linkable assets (build once, earn links over time)

Small free tools people share: gym profit calculator, membership revenue calculator, break-even calculator, GST on gym
memberships calculator, member churn and gym pricing calculators, protein and calorie calculators. They are built, at
`/tools` and `/tools/<name>` (words in `src/lib/domain/tools.ts`, maths in `src/lib/domain/calculators.ts`, both tested), each
with its method written out, a caution that it is not tax or medical advice, and a link to the product page it belongs to.
What is left is the part code cannot do: tell gym owners and fitness writers they exist. Add a tool by adding it to `TOOLS`,
writing its screen in `src/app/(site)/tools/calculators.tsx` and its maths with tests.

## Off-page

- **Gym-software side:** gym-industry publications and owner communities, SaaS and business-software directories (list the
  product with its real prices and screenshots), Indian startup media, accounting and finance sites. Offer them original
  material: a guide, a calculator, or numbers from your own product, not a press release.
- **Fitness side:** fitness blogs, trainers' sites, wellness and fitness-technology publications, Indian fitness communities.
  Offer expert commentary or a guest article on training and food for Indian lifestyles, reviewed by a qualified person.
- **Partner gyms:** ask each partner gym to link to its FITRON page. A real customer linking to you is the best link there is.
- **Digital PR:** one honest announcement per real milestone, tailored to each outlet. Never the same release everywhere.
- **Founder:** the founder's own writing, talks and interviews on building FITRON, Indian fitness technology and gym business.
  This needs the founder's own words and name; it cannot be written for them.
- Do not chase domain rating. A relevant link from a small gym blog beats a generic one from a large site.

## Trust (E-E-A-T)

The site has real pricing, real screenshots, policies, a grievance officer, contact details and an About page (`/about`) made
only of what the product and the policies already say. Three things on it need real facts from the owner, and each is one list in
`src/lib/domain/about-data.json` that is empty until it is filled in. The page, the footers and the structured data show a
section only when its list has an entry, so nothing is ever a placeholder:

1. **`founders`**: a real person who runs FITRON: name, role, and a few lines in their own words (and an optional profile link).
   Appears on `/about` and as `founder` in the Organization structured data.
2. **`social`**: official FITRON accounts that exist (https links). Appear in both footers, on `/about`, and as `sameAs`.
3. **`stories`**: something a real customer said, with their agreement to be published under their name (`permission: true`
   is required). Appears on `/about`.

Also worth doing when you can: real author names and dates on every guide, and the company's registered name, address and GSTIN
(`FITRON_LEGAL_NAME`, `FITRON_ADDRESS`, `FITRON_GSTIN`), which appear on `/about` and `/contact` once set.

Do not add review or rating markup until real reviews exist on a third-party site; the tests fail if it appears.

## Known gaps in this redesign

- **The sign-in page is a chooser, not a form.** Gym owners and members have separate sign-in systems (`/login` and `/trainer`),
  so `/signin` sends people to the right one instead of asking for a password itself.
- **Screenshots** on the Gym Accounting pages are real captures of the console's demo gym (`public/site/features`, 1280 × 760
  WebP), and the pages say so. Retake them when the console changes: sign in to a seeded demo gym (`npm run db:seed`) and
  capture the same pages. The WhatsApp and UPI autopay screens are left out on purpose: in the demo gym they run in
  simulated mode, and a simulated screen should not stand in for live behaviour.
- **Performance** was measured with Lighthouse 12 against a production build (see `docs/PERFORMANCE.md`). Field data (real
  visitors) only exists after launch: watch Search Console's Core Web Vitals report.
