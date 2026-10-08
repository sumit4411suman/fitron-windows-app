# Getting FITRON found on Google and Bing

Nobody can promise a place in the search results, and nobody can buy one honestly: Google decides, and it ranks
the page that best answers the search. What follows is what is built into the site, and the work that only you can do.

## What the site already does

- Public pages about the product: `/gym-accounting`, `/gym-management-software` and `/gym-gst-billing`
  (the words are in `src/lib/domain/gym-pages.ts`), next to the home page, contact page and policies.
- Each page has its own title and description, one canonical address, a link preview, structured data
  (breadcrumbs, FAQ, and the product with its real prices) and a line in `https://fitron.in/sitemap.xml`.
- `www.fitron.in` redirects to `fitron.in`, so there is one address for every page. Pages load without scripts and
  without a sign-in, which is what the search crawler needs.
- Everything a page says about the product is checked against the code by `npm test`. Keep it that way: a claim the
  product cannot back costs you customers and, for prices and reviews, can get a page dropped.

To add a page, add it to `GYM_PAGES`; the sitemap, robots file, link checks and sign-in exemption follow from that list.

## What only you can do

1. **Verify the site in Google Search Console.** Add a *Domain* property for `fitron.in` and put the TXT record it
   gives you in your DNS. Then submit `https://fitron.in/sitemap.xml`, and use *URL inspection → Request indexing*
   on the home page and the three product pages. This is the one step that tells you whether Google can see the site.
2. **Bing Webmaster Tools.** Sign in and choose *Import from Google Search Console*. Bing also feeds DuckDuckGo
   and some assistants.
3. **Get linked from other sites.** Links from sites Google already trusts are the strongest signal there is, and
   no code can create them. Start with the free profiles on software directories (Capterra, GetApp, Software
   Suggest, G2), gym and fitness-business blogs and associations, and the gyms that are your customers and partners
   (ask them to link to `fitron.in` from their site).
4. **Publish things people search for.** Short, honest guides for gym owners ("how to bill gym members with GST",
   "how to read your gym's profit and loss") on this site, each linking to the product page it belongs to.
5. **Collect real reviews.** When customers have written them on a directory, say so on the site. Do not add
   star ratings to the structured data until they are real; made-up ones can get the whole site penalised.
6. **If you have a business address,** claim a Google Business Profile for it, with the same name, address and
   phone as on the Contact page (`FITRON_ADDRESS` and `FITRON_GSTIN`, see `.env.example`).
7. **Watch the results.** In Search Console, *Performance* shows which searches show the site and which get clicks;
   *Pages* shows what is indexed. It takes weeks to show anything and months to settle. Expect to adjust the page
   wording from what you see there.

## More

- `docs/ANALYTICS.md`: switching on Google Analytics (`GA_MEASUREMENT_ID`) and the events it records.
- `docs/PERFORMANCE.md`: how Lighthouse was run, the results and what was done.
- `docs/GROWTH.md`: the content plan, link building, trust gaps and the known gaps of the redesign.
