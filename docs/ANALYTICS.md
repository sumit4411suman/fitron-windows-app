# Analytics on fitron.in

Google Analytics 4 is **off until you switch it on**, and even then it only runs for visitors who agree to it.

1. Create a GA4 property and copy its measurement ID (`G-XXXXXXXXXX`).
2. Set `GA_MEASUREMENT_ID` on the server (`.env`, see `.env.example`) and restart. Until this is set, no analytics code is
   requested by any page, and the Content-Security-Policy does not allow Google's scripts.
3. A visitor's choice is stored in their browser (`localStorage`, key `fitron-site-consent`):
   *Accept all* and *Essential only* on the cookie banner, or *Manage settings* for Preferences and Analytics separately.
   Nothing is sent to Google, and no Google script is loaded, unless **Analytics** is ticked. Withdrawing consent stops
   events and removes the `_ga` cookies.
4. The tracker is `public/site/analytics.js`. It switches off advertising features and Google signals: it is for measurement
   only. FITRON uses no advertising cookies.

The Privacy Policy (`/privacy`, sections "Who we share it with" and "Cookies") names Google Analytics, what it receives, the
`_ga` cookies and that it may process data outside India. Those words were added with the analytics code and are for your
lawyer to review. If you change what the tracker sends (`public/site/analytics.js`), change that text with it.

## Events

Add `data-track="event_name"` (and `data-track-from="where on the page"`) to any link or button and the click is sent.
Some links are named automatically (WhatsApp, e-mail, sign-in, sign-up plans, contact topics).

| Event | When |
| --- | --- |
| `start_trial_click` | "Start Free Trial" in the home page hero (opens the product chooser) |
| `get_started_click` | "Get Started" in the header or phone menu |
| `start_ai_trial` | Any button or link that opens the AI Trainer trial (`/signup?plan=ai-…`) |
| `start_gym_trial` | Any button or link that opens the Gym Accounting trial (`/signup?plan=starter\|professional\|enterprise`) |
| `gym_accounting_click` | "Explore Gym Accounting" in the hero |
| `partner_click` | "Partner With FITRON" in the hero |
| `partner_lead` | "Become a FITRON Partner", "Talk to Sales", a partner plan, or `/contact?topic=partner` |
| `demo_request` | A live-demo link or button (Gym Accounting, or the AI Coach card's "Chat with the AI coach") or `/contact?topic=demo` |
| `pricing_view` | The pricing section scrolled into view (once per page view) |
| `pricing_click` | A plan's button in the pricing section (`plan` = the plan name) |
| `signin_click` | Any link to `/signin` |
| `whatsapp_click` | Any link to `wa.me` |
| `email_click` | Any `mailto:` link |
| `faq_interaction` | A question opened (`question` = its text) |
| `guide_engaged` | A guide read 75% of the way down |
| `contact_submit` | The contact form was sent (`topic` = what was chosen) |

### Not in the website yet

These happen inside the apps, behind a sign-in, where the page policy forbids third-party scripts. They need a server-side
call (GA4 Measurement Protocol) or a deliberate change to the console's Content-Security-Policy, which is a security
decision and not made here:

`signup_complete`, `checkout_initiated`, `subscription_started`, `subscription_cancelled`, `purchase`.

## Search Console

Verify the `fitron.in` domain property, submit `https://fitron.in/sitemap.xml`, and watch Pages (indexing), Core Web Vitals,
Mobile usability, Search results (queries, CTR, average position) and the structured-data reports. See `deploy/SEO.md`.
