# Performance

## How it was measured

Lighthouse 12, headless Chromium, against `next start` of a production build on the same machine (so no network, and the
numbers describe the page and its files, not a host). Mobile is Lighthouse's default: a slow-4G connection and a CPU 4× slower,
all *simulated*. Desktop uses its desktop preset.

```bash
npm run build && npx next start -p 3300 &
npx lighthouse@12 http://localhost:3300/gym-accounting --only-categories=performance,accessibility,best-practices,seo \
  --chrome-flags="--headless=new --no-sandbox"                 # add --preset=desktop for desktop
```

## Result (October 2026)

Lighthouse is a lab test. The real numbers are the field data in Search Console's Core Web Vitals report after launch. The
lab's total blocking time (TBT) stands in for INP, which needs a person using the page.

Twelve public pages, run on a production build: `/`, `/gym-accounting`, `/gym-management-software`, `/gym-gst-billing`,
`/ai-personal-trainer`, `/about`, `/contact`, `/tools`, `/tools/gym-profit-calculator`, `/privacy`, `/terms`, `/guides`.

| | Mobile (simulated slow 4G, 4× slower CPU) | Desktop |
| --- | --- | --- |
| Performance | 95 to 99 | 100 on every page |
| Accessibility, Best practices, SEO | 100 on every page | 100 on every page |
| Largest Contentful Paint (target under 2.5 s) | 2.1 to 3.0 s | 0.5 to 0.7 s |
| Cumulative Layout Shift (target under 0.1) | 0 to 0.002 | 0 to 0.022 |
| Total Blocking Time (INP target under 200 ms) | 20 to 60 ms | 0 ms |

`/signin` scores 66 on SEO because it is deliberately `noindex`.

Mobile LCP in the lab varies by about ±0.5 s from one run to the next on the same page, so a page that reads 2.4 s one time
reads 2.9 s another. Seven of the twelve pages were under 2.5 s in the last run and the rest within half a second of it; in
the same runs the *unthrottled* LCP is about a second or less. `/gym-accounting`, the one page that was consistently high
(3.2 s), is now 2.3 s: its dashboard picture, 54 KB, started inside the first screen on a phone and was counted against the
text, so it now sits after the section links and loads lazily. Watch the field numbers before spending more on it.

## What was done

- The home page's biggest picture is requested at the top of the page, with a smaller file for small screens (`srcset`).
- Pictures below the first screen are lazy; the design had marked two eager and high-priority.
- The 3D logo library (260 KB) loads only when the closing section is near, and not at all where WebGL cannot run.
- Public pages preload the three font files they use (text, headings and the rupee sign) and no longer preload the console's serif font.
- On `/gym-accounting` the dashboard picture follows the section links and is lazy, so it does not load ahead of the text on a phone.
- The cookie banner on the public pages waits 2.5 s so it is not the largest thing painted.
- The logo's picture keeps its aspect ratio, and only the logo at the top of a page is high-priority.

## If a score drops

Run the command above on the page that changed. The usual causes: a new picture larger than the slot it fills, a picture
above the fold that is not preloaded, a script added to every page, or a font weight added to `site.css`.
