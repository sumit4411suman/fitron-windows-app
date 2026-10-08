#!/usr/bin/env python3
"""Edits to the home page (public/site/index.html) that are not in the design export.

scripts/import-site.py rebuilds the page from the design export, so every edit we make on top of it
lives here and is applied by the importer after it has rewired the buttons. Run on its own to patch
the page in place:

    python3 scripts/site_patches.py

Every patch is idempotent: running it on a page that already has it changes nothing, and a patch that
no longer applies (the design changed the text it looks for) stops with a message instead of being skipped.
"""
import html as htmllib
import json
import os
import re
import sys

PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "site", "index.html")


def swap(page, old, new, why):
    """Replace `old` with `new` once. `new` must not contain `old`, so a patched page is recognised."""
    assert old not in new, why
    if old in page:
        assert page.count(old) == 1, f"{why}: expected one match, found {page.count(old)}"
        return page.replace(old, new)
    assert new in page, f"{why}: neither the original text nor the patched text is on the page"
    return page


def add(page, anchor, addition, marker, why, before=False):
    """Insert `addition` next to the first `anchor`, unless `marker` shows it is already there."""
    if marker in page:
        return page
    assert anchor in page, f"{why}: anchor not found"
    return page.replace(anchor, addition + anchor if before else anchor + addition, 1)


# What Gym Accounting really exports is Excel and CSV (reports, ledgers, member and payment lists).
# It has no Tally import file, so the page must not promise one.
TEXT = [
    ("Numbered invoices, month exported to Tally for your accountant", "Numbered invoices, month exported to Excel for your accountant", "stats band"),
    ("Tally export, month lock, audit log", "Excel and CSV export, month lock, audit log", "Gym Accounting card"),
    ("Does Gym Accounting work with Tally and GST?", "Does Gym Accounting handle GST and my accountant's books?", "FAQ question"),
    ("as a Tally file or Excel for your accountant.", "as Excel or CSV files for your accountant.", "FAQ answer"),
    # GST can be switched off (Settings > Billing & GST), so the answer must not say every payment makes a GST invoice.
    (
        "Yes. Every payment creates a numbered GST invoice with your GSTIN and CGST/SGST split, and at month-end you export",
        "Yes. Every sale gets a numbered invoice. When GST is switched on, it shows your GSTIN and the CGST and SGST split (or IGST) at the rate you set. At month-end you export",
        "FAQ answer: GST is optional",
    ),
    # Only invoices come out as PDF, so the Professional card no longer promises "PDF financial exports": what it adds
    # is Excel and CSV exports of the accounting reports and ledgers (the Accounting section is Professional).
    ("Excel and PDF financial exports", "Excel and CSV accounting exports", "Professional card: exports"),
    # AI Pro and AI Premium. The app gives every member the same features (workouts, food plan, habits, progress,
    # reminders, weekly review) and differs by tier in one thing only: AI Coach messages per day, 25 or 100
    # (COACH_DAILY_LIMIT in src/lib/domain/trainer.ts; landing-page.test.ts keeps the numbers equal). The page
    # used to list six Premium-only features that every member already has, and called the limit monthly.
    ("<span>Basic progress tracking</span>", "<span>Progress tracking and a weekly review</span>", "AI Pro: progress"),
    ("<span>AI fitness chat, with monthly usage limits</span>", "<span>AI Coach: 25 messages a day</span>", "AI Pro: chat limit"),
    ('<p class="pc-who">Advanced AI coaching and long-term progress tracking.</p>', '<p class="pc-who">Everything in AI Pro, with a higher daily AI Coach limit.</p>', "AI Premium: tagline"),
    # The number of sections in the sidebar (src/lib/nav.ts); site-links.test.ts keeps them equal.
    ('<span class="num-3d gold-3d">22</span><p>Gym modules', '<span class="num-3d gold-3d">24</span><p>Gym modules', "module count"),
    # The same count appears twice more; landing-page.test.ts checks every "N modules" on the page against the sidebar.
    ("</svg>22 modules: members, billing, GST, expenses, P&amp;L", "</svg>24 modules: members, billing, GST, expenses, P&amp;L", "Gym Accounting card: module count"),
    ("Gym Accounting, all 22 modules", "Gym Accounting, all 24 modules", "partner perks: module count"),
    # What search results show: the page leads with what people search for. Kept under about 60 and 160 characters
    # (landing-page.test.ts). The visible headline is the design's and is left alone.
    (
        "<title>FITRON — Your AI personal trainer, and your gym's accounts</title>",
        "<title>Gym Accounting Software &amp; AI Personal Trainer | FITRON</title>",
        "page title",
    ),
    (
        '<meta name="description" content="FITRON: an AI personal trainer for ₹299 a month, and gym accounting software with GST invoices, WhatsApp reminders and P&amp;L from ₹999 a month.">',
        '<meta name="description" content="Gym accounting software with GST invoices, fees, WhatsApp reminders and P&amp;L from ₹999 a month, plus an AI personal trainer for ₹299 a month. 7-day free trial.">',
        "meta description",
    ),
    (
        '<meta property="og:title" content="FITRON: your AI trainer, and your gym\'s accounts">',
        '<meta property="og:title" content="FITRON: gym accounting software and an AI personal trainer">',
        "link preview title",
    ),
    # Links to the pages about Gym Accounting (src/lib/domain/gym-pages.ts): the footer and two FAQ answers. The product
    # card's second button opens the live demo instead (LIVE_DEMO below).
    (
        '<a class="btn btn-gold" href="/signup?plan=professional">Start free trial <svg class="icon"><use href="#i-arrow"></use></svg></a><a class="btn btn-ghost" href="#products">Full details</a>',
        '<a class="btn btn-gold" href="/signup?plan=professional">Start free trial <svg class="icon"><use href="#i-arrow"></use></svg></a><a class="btn btn-ghost" href="/site/gym-demo.html" target="_blank" rel="noopener" data-ld-open>Demo product <svg class="icon"><use href="#i-play"></use></svg></a>',
        "Gym Accounting card: Demo product (opens the live demo full screen; the link is the no-script fallback)",
    ),
    (
        '<li><a href="#products">Gym Accounting</a></li><li><a href="#together">Better together</a></li>',
        '<li><a href="/gym-accounting">Gym Accounting</a></li><li><a href="/gym-management-software">Gym management software</a></li><li><a href="/gym-gst-billing">GST invoices for gyms</a></li><li><a href="#together">Better together</a></li>',
        "footer links to the Gym Accounting pages",
    ),
    (
        "as Excel or CSV files for your accountant.</p></details>",
        'as Excel or CSV files for your accountant. <a href="/gym-gst-billing">How GST billing works.</a></p></details>',
        "FAQ: GST link",
    ),
    ('<a href="#faq">More on gym accounting.</a>', '<a href="/gym-accounting">More on gym accounting.</a>', "FAQ: branches link"),
    # Billing, as the product now works (Razorpay Subscriptions): plans renew automatically by UPI AutoPay, card or
    # net-banking mandate and can be cancelled any time, and the listed prices include GST (the customer pays exactly the
    # listed price). The design said nothing auto-debits and that prices are exclusive of GST. The Terms and Refund pages
    # (src/app/(site)/terms, refund) say the same.
    (
        "Prices in rupees, exclusive of GST. Pay by UPI.</p>",
        "Prices in rupees, inclusive of GST. Pay by UPI or card; plans renew automatically and you can cancel any time.</p>",
        "pricing intro: GST and renewal",
    ),
    (
        "All add-ons are exclusive of GST and subject to scope and availability.",
        "All add-ons are inclusive of GST and subject to scope and availability.",
        "add-ons: GST",
    ),
    (
        "in Indian rupees, exclusive of applicable GST unless stated otherwise.",
        "in Indian rupees, inclusive of 18% GST unless stated otherwise.",
        "pricing disclaimer: GST",
    ),
    (
        "open Gym Accounting today and pay by UPI when the trial ends.",
        "open Gym Accounting today and pay online when the trial ends (UPI AutoPay, card or net banking).",
        "FAQ: available now, how to pay",
    ),
    (
        "when the trial ends your data stays as it was and you pay by UPI to continue.",
        "when the trial ends your data stays as it was and you pay online to continue (UPI AutoPay, card or net banking).",
        "FAQ: free trial, how to pay",
    ),
    (
        "There is nothing to cancel: neither product auto-debits. Simply don't renew. In the AI trainer you can also switch off the plan from Settings → Subscription, and keep access until the paid period ends.",
        "Plans renew automatically through Razorpay (UPI AutoPay, card or net-banking mandate) for the period you chose, monthly or yearly. You can cancel any time from Settings › Plan &amp; billing in Gym Accounting, or Settings › Subscription in the AI Trainer. The plan stays active until the end of the period you have already paid for.",
        "FAQ: cancelling",
    ),
    # The Gym Partnership's 70% is of the price before GST (the GST inside a listed price is not shared), as the Terms
    # say ("after taxes") and as the console pays it (PARTNER_SHARE of a payment's `base`). The design worked it out
    # from the listed price. pricing.test.ts checks these figures against the same functions the console uses.
    (
        '<tr><td>₹299 / month</td><td class="num g">₹209.30</td><td class="num">₹89.70</td></tr><tr><td>₹499 / month</td><td class="num g">₹349.30</td><td class="num">₹149.70</td></tr><tr><td>₹1,999 / year</td><td class="num g">₹1,399.30</td><td class="num">₹599.70</td></tr><tr><td>₹4,999 / year</td><td class="num g">₹3,499.30</td><td class="num">₹1,499.70</td></tr>',
        '<tr><td>₹299 / month</td><td class="num g">₹177.37</td><td class="num">₹76.02</td></tr><tr><td>₹499 / month</td><td class="num g">₹296.02</td><td class="num">₹126.86</td></tr><tr><td>₹1,999 / year</td><td class="num g">₹1,185.85</td><td class="num">₹508.22</td></tr><tr><td>₹4,999 / year</td><td class="num g">₹2,965.51</td><td class="num">₹1,270.93</td></tr>',
        "partner earnings table: 70% of the price before GST",
    ),
    (
        "never shown to the gym. <a href=\"/privacy\">Read the policies.</a>",
        "never shown to the gym. The AI replies are written by an AI provider that may process them outside India: the privacy policy says what is sent. <a href=\"/privacy\">Read the policies.</a>",
        "FAQ: data",
    ),
    # The AI Trainer has its own page (/ai-personal-trainer, src/lib/domain/trainer-page.ts), like Gym Accounting does,
    # so the links that promise more about it go there and search engines find it from the home page.
    ('<a class="btn btn-ghost" href="#products">Full details</a>', '<a class="btn btn-ghost" href="/ai-personal-trainer">Full details</a>', "AI Trainer card: details link"),
    ('<a href="#faq">More on the AI trainer.</a>', '<a href="/ai-personal-trainer">More on the AI trainer.</a>', "FAQ: AI trainer link"),
    (
        '<ul class="foot-links"><li><a href="#products">AI Trainer</a></li>',
        '<ul class="foot-links"><li><a href="/ai-personal-trainer">AI personal trainer</a></li>',
        "footer: AI Trainer link",
    ),
    # Redesign: the title, description and link preview use the wording of the brief (about 55 and 150 characters).
    ("<title>Gym Accounting Software &amp; AI Personal Trainer | FITRON</title>", "<title>FITRON — AI Personal Trainer &amp; Gym Accounting Software</title>", "page title: redesign"),
    (
        '<meta name="description" content="Gym accounting software with GST invoices, fees, WhatsApp reminders and P&amp;L from ₹999 a month, plus an AI personal trainer for ₹299 a month. 7-day free trial.">',
        '<meta name="description" content="FITRON combines an AI personal trainer for individuals with gym accounting and management software for Indian gyms. Start your 7-day free trial.">',
        "meta description: redesign",
    ),
    ('<meta property="og:title" content="FITRON: gym accounting software and an AI personal trainer">', '<meta property="og:title" content="FITRON — AI Personal Trainer &amp; Gym Accounting Software">', "link preview title: redesign"),
    (
        '<meta property="og:description" content="An AI personal trainer for ₹299 a month. Gym accounting software from ₹999 a month. 7-day free trial on both.">',
        '<meta property="og:description" content="An AI personal trainer from ₹299 a month and gym accounting software from ₹999 a month, in one platform. 7-day free trial.">',
        "link preview description: redesign",
    ),
    # Products section: the heading of the brief, ten features on each card, and each card's two buttons.
    (
        '<h2 id="products-title" class="reveal-3d">Pick your side. Or take both.</h2>\n      <p class="lead reveal">One for the person training. One for the gym they train in. Each works on its own; together they share one brain.</p>',
        '<h2 id="products-title" class="reveal-3d">Two products. One FITRON.</h2>\n      <p class="lead reveal">One for the person training. One for the gym they train in.</p>',
        "products heading: redesign",
    ),
    (
        "<p>An AI coach that builds your workouts, plans Indian meals around your budget, tracks your progress and talks to you every day. At home or in the gym.</p>",
        "<p>An AI coach that builds workouts, plans Indian meals around your goals and budget, tracks progress and supports you every day.</p>",
        "AI Trainer card: description",
    ),
    (
        "<p>Members, fees, GST invoices, WhatsApp reminders, attendance, payroll and P&amp;L in one console. For one gym or every branch you run.</p>",
        "<p>Manage members, fees, GST invoices, expenses, payroll, payments, reminders and profit &amp; loss in one console.</p>",
        "Gym Accounting card: description",
    ),
    (
        '<a class="btn btn-gold" href="/signup?plan=ai-pro">Start free trial <svg class="icon"><use href="#i-arrow"></use></svg></a><a class="btn btn-ghost" href="/ai-personal-trainer">Full details</a>',
        '<a class="btn btn-gold" href="/signup?plan=ai-pro" data-track="start_ai_trial" data-track-from="products">Start AI Trainer Trial <svg class="icon"><use href="#i-arrow"></use></svg></a><a class="btn btn-ghost" href="/ai-personal-trainer">Explore AI Trainer</a>',
        "AI Trainer card: buttons",
    ),
    (
        '<a class="btn btn-gold" href="/signup?plan=professional">Start free trial <svg class="icon"><use href="#i-arrow"></use></svg></a><a class="btn btn-ghost" href="/site/gym-demo.html" target="_blank" rel="noopener" data-ld-open>Demo product <svg class="icon"><use href="#i-play"></use></svg></a>',
        '<a class="btn btn-gold" href="/signup?plan=professional" data-track="start_gym_trial" data-track-from="products">Start Gym Accounting Trial <svg class="icon"><use href="#i-arrow"></use></svg></a><a class="btn btn-ghost" href="/gym-accounting">Explore Gym Accounting</a><a class="hero-partner" href="/site/gym-demo.html" target="_blank" rel="noopener" data-ld-open data-track="demo_request" data-track-from="products">Try the live demo</a>',
        "Gym Accounting card: buttons",
    ),
    # Partnership: the buttons of the brief (the WhatsApp link stays as a third way to reach us), and the step names.
    (
        '<a class="btn btn-gold" href="https://wa.me/916207774673?text=Hi%20FITRON%2C%20I%20run%20a%20gym%20and%20want%20to%20talk%20about%20a%20partnership." target="_blank" rel="noopener">Partner with us on WhatsApp <svg class="icon"><use href="#i-arrow"></use></svg></a>\n          <a class="btn btn-ghost" href="mailto:hello@fitron.in?subject=FITRON%20Gym%20Partnership">Email hello@fitron.in</a>',
        '<a class="btn btn-gold" href="#pricing" data-pricing-tab="par" data-track="partner_lead" data-track-from="partnership">Become a FITRON Partner <svg class="icon"><use href="#i-arrow"></use></svg></a>\n          <a class="btn btn-ghost" href="/contact?topic=partner" data-track="partner_lead" data-track-from="partnership-sales">Talk to Sales</a>\n          <a class="hero-partner" href="https://wa.me/916207774673?text=Hi%20FITRON%2C%20I%20run%20a%20gym%20and%20want%20to%20talk%20about%20a%20partnership." target="_blank" rel="noopener">WhatsApp us</a>',
        "partnership: buttons",
    ),
    ("<h3>We brand the app</h3>", "<h3>We brand the experience</h3>", "partnership step 2"),
    ("<h3>Members join in a day</h3>", "<h3>Members join</h3>", "partnership step 3"),
    ("<h3>You get paid monthly</h3>", "<h3>You receive monthly settlement</h3>", "partnership step 4"),
]

BOOT_STEPS = [
    # The 3D logo shows only with the closing call to action (redesign), so its library is fetched when that section is near, and
    # not at all where WebGL cannot run (it would only log an error): no 260 KB download and no script work while reading.
    (
        "const lite = matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator.connection && navigator.connection.saveData);",
        "const webgl = (() => { try { const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl'); if (!g) return false; const x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (_) { return false; } })();\nconst lite = !webgl || matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator.connection && navigator.connection.saveData);",
        "3D logo: only where WebGL runs",
    ),
    (
        "if (!lite) { if (document.readyState === 'complete') later(); else addEventListener('load', later); }",
        "if (!lite) {\n  const join = document.getElementById('join');\n  if (join && 'IntersectionObserver' in window) { const near = new IntersectionObserver((es) => { if (es[0].isIntersecting) { near.disconnect(); later(); } }, { rootMargin: '1200px 0px' }); near.observe(join); }\n  else if (document.readyState === 'complete') later(); else addEventListener('load', later);\n}",
        "3D logo: loaded when the closing section is near",
    ),
]

# Pictures far below the first screen no longer fetch ahead of it. The design marked the product card's two screenshots eager and
# high-priority, so on a phone they competed with the stylesheet and fonts for the first paint.
LATE_STEPS = [
    (
        'loading="eager" fetchpriority="high" decoding="async" style="display:block;width:100%;height:100%;object-fit:cover;object-position:50% 0"',
        'loading="lazy" decoding="async" style="display:block;width:100%;height:100%;object-fit:cover;object-position:50% 0"',
        "AI Trainer card screenshot: lazy",
    ),
    ('<img class="ld-poster" src="/site/console-dashboard.webp"', '<img class="ld-poster" loading="lazy" decoding="async" src="/site/console-dashboard.webp"', "Gym Accounting card poster: lazy"),
]

# The live Gym Accounting demo in the product card. The dashboard picture gets a "Try the live demo" button that loads the
# prototype (public/site/gym-demo.html, self-contained) into the card, drawn at desktop size and scaled to fit, and a "Full
# screen" button; the card's "Demo product" button opens it full screen too. next.config.ts lets only our own pages frame it.
LIVE_DEMO_OLD = '<div class="media"><div class="mini-console lift-sm" style="padding:0;overflow:hidden;aspect-ratio:16/10.4"><img src="/site/console-dashboard.webp" alt="FITRON Gym Accounting dashboard: active members, revenue, outstanding and renewals for Power Haus Gym" style="display:block;width:100%;height:100%;object-fit:cover;object-position:0 0"></div></div>'
LIVE_DEMO_NEW = '<div class="media"><div class="mini-console lift-sm live-demo" id="liveDemo" data-src="/site/gym-demo.html" style="padding:0;overflow:hidden;aspect-ratio:16/10.4"><img class="ld-poster" src="/site/console-dashboard.webp" alt="FITRON Gym Accounting dashboard: active members, revenue, outstanding and renewals for Power Haus Gym" style="display:block;width:100%;height:100%;object-fit:cover;object-position:0 0"><button type="button" class="ld-play" data-ld-play><span class="ld-play-ring"><svg class="icon"><use href="#i-play"></use></svg></span><span class="ld-play-text">Try the live demo<small>Click around a working console with demo data</small></span></button><div class="ld-tools"><button type="button" class="ld-btn" data-ld-full aria-label="Open the live demo full screen"><svg class="icon"><use href="#i-expand"></use></svg><span>Full screen</span></button><a class="ld-btn" href="/site/gym-demo.html" target="_blank" rel="noopener" aria-label="Open the live demo in a new tab"><svg class="icon"><use href="#i-external"></use></svg></a></div></div></div>'
LIVE_DEMO_ICONS = '  <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"></path></symbol>\n  <symbol id="i-expand" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path></symbol>\n  <symbol id="i-shrink" viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"></path></symbol>\n  <symbol id="i-external" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path></symbol>\n'
LIVE_DEMO_CSS = (
    '/*fitron:live-demo*/.live-demo{position:relative;isolation:isolate}'
    '.live-demo .ld-poster{transition:opacity .5s,filter .4s}'
    '.live-demo:not(.running):hover .ld-poster{filter:brightness(.72)}'
    '.ld-frame{position:absolute;top:0;left:0;width:1280px;height:832px;border:0;background:#0e0d0a;transform:scale(var(--ld-scale,.4));transform-origin:0 0;opacity:0;transition:opacity .5s}'
    '.live-demo.ready .ld-frame{opacity:1}'
    '.live-demo.ready .ld-poster{opacity:0}'
    '.ld-play{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px;border:0;background:radial-gradient(circle at 50% 50%,rgba(14,13,10,.55),rgba(14,13,10,.15) 70%);color:var(--text);font:600 1rem/1.25 var(--font-body);cursor:pointer;text-align:center}'
    '.ld-play-ring{display:grid;place-items:center;width:68px;height:68px;border-radius:50%;background:var(--gold-grad);color:#17140d;box-shadow:0 1px 0 #8f6a1c,0 3px 0 #634812,0 18px 34px -10px rgba(0,0,0,.8);transition:transform .3s var(--ease)}'
    '.ld-play-ring .icon{width:28px;height:28px;fill:currentColor;stroke-width:1.4;margin-left:3px}'
    '.ld-play:hover .ld-play-ring,.ld-play:focus-visible .ld-play-ring{transform:scale(1.08)}'
    '.ld-play-text{display:grid;gap:4px;padding:8px 14px;border-radius:12px;background:rgba(14,13,10,.72);border:1px solid var(--line-2)}'
    '.ld-play-text small{font-size:.74rem;font-weight:500;color:var(--muted)}'
    '.live-demo.running .ld-play{display:none}'
    '.ld-loading{position:absolute;inset:0;z-index:2;display:grid;place-items:center;font:600 .9rem var(--font-body);color:var(--gold-2);background:rgba(14,13,10,.55)}'
    '.ld-loading::after{content:"";position:absolute;left:50%;top:calc(50% + 22px);width:110px;height:3px;margin-left:-55px;border-radius:2px;background:linear-gradient(90deg,var(--gold-deep),var(--gold-2));animation:demoLoad 1.6s ease-in-out infinite}'
    '.live-demo.ready .ld-loading{display:none}'
    '.ld-tools{position:absolute;right:10px;bottom:10px;z-index:3;display:flex;gap:6px}'
    '.ld-btn{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 11px;border-radius:999px;border:1px solid var(--line-2);background:rgba(14,13,10,.82);color:var(--gold-2);font:600 .76rem/1 var(--font-body);text-decoration:none;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:background .2s,border-color .2s}'
    '.ld-btn:hover,.ld-btn:focus-visible{background:rgba(38,34,24,.95);border-color:var(--gold)}'
    '.ld-btn .icon{width:16px;height:16px;stroke-width:2}'
    '.live-demo:fullscreen{width:100%;height:100%;max-width:none;aspect-ratio:auto!important;border:0;border-radius:0;transform:none;background:#0e0d0a}'
    '.live-demo:fullscreen .ld-frame{width:100%;height:100%;transform:none}'
    '.live-demo:fullscreen .ld-poster{display:none}'
    '.live-demo:fullscreen .ld-tools{right:8px;bottom:auto;top:50%;translate:0 -50%;flex-direction:column;opacity:.6;transition:opacity .2s}'
    '.live-demo:fullscreen .ld-tools:hover,.live-demo:fullscreen .ld-tools:focus-within{opacity:1}'
    '.live-demo:fullscreen .ld-btn{width:38px;min-height:38px;padding:0;justify-content:center}'
    '.live-demo:fullscreen .ld-btn span{display:none}'
    '@media (max-width:560px){.ld-play{gap:10px;padding:10px 10px 52px}.ld-play-ring{width:54px;height:54px}.ld-play-ring .icon{width:22px;height:22px}.ld-play-text small{display:none}}'
    '@media (prefers-reduced-motion:reduce){.ld-frame,.live-demo .ld-poster,.ld-play-ring{transition:none}.ld-loading::after{animation:none}}'
)
LIVE_DEMO_JS = """<script>/*fitron:live-demo-js*/
(function () {
  // The live Gym Accounting demo in the product card (#liveDemo): the prototype in public/site/gym-demo.html, loaded on
  // demand, drawn at desktop size and scaled to the card; "Full screen" shows it at full size. It keeps its demo data in
  // this browser's localStorage under its own fitron-*-v1 keys, which nothing else on fitron.in uses.
  var $ = (s, r) => (r || document).querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const live = $('#liveDemo');
  if (!live) return;
  const W = 1280;
  const fullBtn = $('[data-ld-full]', live), playBtn = $('[data-ld-play]', live);
  const canFull = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const isFull = () => (document.fullscreenElement || document.webkitFullscreenElement) === live;
  const fit = () => live.style.setProperty('--ld-scale', (live.clientWidth / W).toFixed(4));
  let frame = null;
  const start = () => {
    if (frame) return;
    // Open the demo signed in as the gym's owner, as if they had used the demo login shown on its sign-in page.
    try {
      if (!localStorage.getItem('fitron-session-v1')) {
        const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
        const at = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
        localStorage.setItem('fitron-session-v1', JSON.stringify({ name: 'Sumit Kumar', email: 'sumit@powerhausgym.in', provider: 'password', role: 'Super Admin', at, photo: '' }));
      }
    } catch (e) { /* storage blocked: the demo opens on its sign-in page instead */ }
    live.classList.add('running');
    const card = live.closest('[data-tilt]');
    if (card) { card.removeAttribute('data-tilt'); card.classList.remove('tilting'); card.style.transform = 'none'; }
    const loading = document.createElement('div');
    loading.className = 'ld-loading'; loading.textContent = 'Opening the demo console…';
    live.appendChild(loading);
    frame = document.createElement('iframe');
    frame.className = 'ld-frame'; frame.title = 'FITRON Gym Accounting live demo'; frame.src = live.dataset.src;
    frame.setAttribute('allow', 'fullscreen');
    live.insertBefore(frame, $('.ld-tools', live));
    fit();
    let waited = 0;
    const poll = setInterval(() => {
      waited += 300; let ready = false;
      try { const b = frame.contentDocument && frame.contentDocument.body; ready = !!b && b.innerText.length > 80; } catch (e) { ready = true; }
      if (ready || waited > 20000) { clearInterval(poll); live.classList.add('ready'); }
    }, 300);
  };
  const setFullUi = () => {
    const on = isFull();
    fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Open the live demo full screen');
    $('use', fullBtn).setAttribute('href', on ? '#i-shrink' : '#i-expand');
    $('span', fullBtn).textContent = on ? 'Exit full screen' : 'Full screen';
    fit();
  };
  const toggleFull = () => {
    if (!canFull) { window.open(live.dataset.src, '_blank', 'noopener'); return; }
    if (isFull()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    // Ask for full screen first, inside the click, then load the demo into it.
    const req = live.requestFullscreen || live.webkitRequestFullscreen;
    const r = req.call(live);
    if (r && r.catch) r.catch(() => window.open(live.dataset.src, '_blank', 'noopener'));
    start();
  };
  playBtn.addEventListener('click', () => {
    // On a phone the scaled console is too small to use, so it opens at full size straight away.
    if (innerWidth < 760) toggleFull(); else { start(); frame.focus(); }
  });
  fullBtn.addEventListener('click', toggleFull);
  // "Demo product" under the card opens the same demo full screen (its link to the demo page is the no-script fallback).
  $$('[data-ld-open]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); if (!isFull()) toggleFull(); }));
  document.addEventListener('fullscreenchange', setFullUi);
  document.addEventListener('webkitfullscreenchange', setFullUi);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(live); else addEventListener('resize', fit);
})();
</script>
"""

# The alt text of the AI Trainer card's picture, which is now the coach (see below).
ALT = "FITRON AI Coach chat on a phone: a member asks for a legs workout and the coach replies with the exercises, sets and reps"

# The live AI Coach demo in the AI Trainer card, the twin of the Gym Accounting one above. The card's phone screenshot becomes
# a picture of the coach (public/site/coach-demo.webp, made by scripts/coach-demo-poster.mjs) with a "Chat with the AI coach"
# button that loads the member app prototype (public/site/coach-demo.html, made by scripts/build-coach-demo.py) into the
# phone, drawn at phone size and scaled to fit; "Full screen" shows it at full size. Its coach answers from /api/coach/demo
# (src/app/api/coach/demo/route.ts). next.config.ts lets only our own pages frame it.
COACH_DEMO_OLD = (
    '<div class="media"><div class="gallery" data-gallery="1">\n'
    '          <div class="phone glare" data-tilt="1"><div class="screen" style="padding:0;gap:0;background:#0e0d0a">'
    f'<img data-gallery-img="" src="/site/app-dashboard.webp" alt="{ALT}" loading="lazy" decoding="async" style="display:block;width:100%;height:100%;object-fit:cover;object-position:50% 0"></div></div>\n'
    '        </div></div>'
)
COACH_DEMO_NEW = (
    '<div class="media"><div class="gallery cd-gallery" data-gallery="1">\n'
    '          <div class="phone coach-live" id="coachDemo" data-src="/site/coach-demo.html"><div class="screen" style="padding:0;gap:0;background:#f4f1e8">'
    f'<img data-gallery-img="" src="/site/coach-demo.webp" alt="{ALT}" class="cd-poster" width="560" height="1100" loading="lazy" decoding="async" style="display:block;width:100%;height:100%;object-fit:cover;object-position:50% 0">'
    '<button type="button" class="cd-play" data-cd-play data-track="demo_request" data-track-from="ai-coach-demo"><span class="ld-play-ring"><svg class="icon"><use href="#i-play"></use></svg></span>'
    '<span class="ld-play-text">Chat with the AI coach<small>Ask it anything, live</small></span></button></div>'
    '<button type="button" class="ld-btn cd-exit" data-cd-exit aria-label="Exit full screen"><svg class="icon"><use href="#i-shrink"></use></svg></button></div>\n'
    '          <div class="cd-tools"><button type="button" class="ld-btn" data-cd-full aria-label="Open the AI coach demo full screen"><svg class="icon"><use href="#i-expand"></use></svg><span>Full screen</span></button>'
    '<a class="ld-btn" href="/site/coach-demo.html" target="_blank" rel="noopener" aria-label="Open the AI coach demo in a new tab"><svg class="icon"><use href="#i-external"></use></svg></a></div>\n'
    '          <p class="sc-fine cd-fine">Live demo with a sample member. General guidance, not medical advice.</p>\n'
    '        </div></div>'
)
COACH_CTA_OLD = '<a class="btn btn-ghost" href="/ai-personal-trainer">Explore AI Trainer</a></div>\n      </article>'
COACH_CTA_NEW = (
    '<a class="btn btn-ghost" href="/ai-personal-trainer">Explore AI Trainer</a>'
    '<a class="hero-partner" href="/site/coach-demo.html" target="_blank" rel="noopener" data-cd-open data-track="demo_request" data-track-from="products">Chat with the AI coach</a></div>\n      </article>'
)
COACH_DEMO_CSS = (
    # These come before the card's own rules (.gallery .phone, .twin-card .media .phone) in the page, so they are written
    # with more specific selectors rather than relying on coming last.
    '/*fitron:coach-demo*/.twin-card .cd-gallery{grid-template-columns:1fr;justify-items:center;row-gap:12px}'
    '.twin-card .cd-gallery .phone{width:min(280px,100%)}'
    '.coach-live .screen{position:relative}'
    '.coach-live .cd-poster{transition:opacity .5s,filter .4s}'
    '.coach-live:not(.running):hover .cd-poster{filter:brightness(.8)}'
    '.cd-frame{position:absolute;top:0;left:0;width:392px;height:var(--cd-h,770px);border:0;background:#f4f1e8;transform:scale(var(--cd-scale,.64));transform-origin:0 0;opacity:0;transition:opacity .5s}'
    '.coach-live.ready .cd-frame{opacity:1}'
    '.coach-live.ready .cd-poster{opacity:0}'
    '.cd-play{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:12px;padding:16px 12px 30px;border:0;background:linear-gradient(180deg,rgba(14,13,10,0) 45%,rgba(14,13,10,.6));color:var(--text);font:600 1rem/1.25 var(--font-body);cursor:pointer;text-align:center}'
    '.cd-play:hover .ld-play-ring,.cd-play:focus-visible .ld-play-ring{transform:scale(1.08)}'
    '.coach-live.running .cd-play{display:none}'
    '.cd-loading{position:absolute;inset:0;z-index:2;display:grid;place-items:center;font:600 .85rem var(--font-body);color:#6b5413;background:rgba(244,241,232,.72)}'
    '.cd-loading::after{content:"";position:absolute;left:50%;top:calc(50% + 22px);width:90px;height:3px;margin-left:-45px;border-radius:2px;background:linear-gradient(90deg,var(--gold-deep),var(--gold-2));animation:demoLoad 1.6s ease-in-out infinite}'
    '.coach-live.ready .cd-loading{display:none}'
    '.cd-tools{display:flex;gap:6px}'
    '.twin-card .cd-fine{margin:0;text-align:center}'
    '.coach-live .cd-exit{display:none}'
    '.twin-card .media .coach-live:fullscreen{width:100%;height:100%;max-width:none;aspect-ratio:auto;padding:0;border:0;border-radius:0;box-shadow:none;background:#f4f1e8;transform:none}'
    '.coach-live:fullscreen::before,.coach-live:fullscreen::after{display:none}'
    '.twin-card .media .coach-live:fullscreen .screen{border-radius:0}'
    '.coach-live:fullscreen .cd-frame{width:100%;height:100%;transform:none}'
    '.coach-live:fullscreen .cd-poster{display:none}'
    '.coach-live:fullscreen .cd-exit{display:inline-flex;position:absolute;z-index:3;right:8px;top:50%;translate:0 -50%;width:38px;min-height:38px;padding:0;justify-content:center;opacity:.6;transition:opacity .2s}'
    '.coach-live:fullscreen .cd-exit:hover,.coach-live:fullscreen .cd-exit:focus-visible{opacity:1}'
    '@media (prefers-reduced-motion:reduce){.cd-frame,.coach-live .cd-poster{transition:none}.cd-loading::after{animation:none}}'
)
COACH_DEMO_JS = """<script>/*fitron:coach-demo-js*/
(function () {
  // The live AI Coach demo in the AI Trainer card (#coachDemo): the member app prototype in public/site/coach-demo.html, loaded
  // on demand, drawn at phone size (392 px wide) and scaled to the phone on the card; "Full screen" shows it at full size.
  // It keeps its own data in this browser's localStorage under fitron-demo.* names, which nothing else on fitron.in uses.
  var $ = (s, r) => (r || document).querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const live = $('#coachDemo');
  if (!live) return;
  const W = 392;
  const screen = $('.screen', live), playBtn = $('[data-cd-play]', live), exitBtn = $('[data-cd-exit]', live), fullBtn = $('[data-cd-full]');
  const canFull = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const isFull = () => (document.fullscreenElement || document.webkitFullscreenElement) === live;
  const fit = () => {
    const k = screen.clientWidth / W;
    live.style.setProperty('--cd-scale', k.toFixed(4));
    live.style.setProperty('--cd-h', (screen.clientHeight / k).toFixed(1) + 'px');
  };
  let frame = null;
  const start = () => {
    if (frame) return;
    live.classList.add('running');
    const card = live.closest('[data-tilt]');
    if (card) { card.removeAttribute('data-tilt'); card.classList.remove('tilting'); card.style.transform = 'none'; }
    const loading = document.createElement('div');
    loading.className = 'cd-loading'; loading.textContent = 'Opening the AI coach…';
    screen.appendChild(loading);
    frame = document.createElement('iframe');
    frame.className = 'cd-frame'; frame.title = 'FITRON AI Coach live demo'; frame.src = live.dataset.src;
    screen.appendChild(frame);
    fit();
    let waited = 0;
    const poll = setInterval(() => {
      waited += 300; let ready = false;
      try { const b = frame.contentDocument && frame.contentDocument.body; ready = !!b && b.innerText.length > 80; } catch (e) { ready = true; }
      if (ready || waited > 20000) { clearInterval(poll); live.classList.add('ready'); }
    }, 300);
  };
  const toggleFull = () => {
    if (!canFull) { window.open(live.dataset.src, '_blank', 'noopener'); return; }
    if (isFull()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    // Ask for full screen first, inside the click, then load the demo into it.
    const req = live.requestFullscreen || live.webkitRequestFullscreen;
    const r = req.call(live);
    if (r && r.catch) r.catch(() => window.open(live.dataset.src, '_blank', 'noopener'));
    start();
  };
  // The demo is 3 MB: begin fetching it when a pointer reaches the button, so it opens sooner.
  playBtn.addEventListener('pointerenter', () => {
    const l = document.createElement('link');
    l.rel = 'prefetch'; l.href = live.dataset.src;
    document.head.appendChild(l);
  }, { once: true });
  playBtn.addEventListener('click', () => {
    // On a phone the scaled phone is too small to type in, so it opens at full size straight away.
    if (innerWidth < 760) toggleFull(); else { start(); frame.focus(); }
  });
  fullBtn.addEventListener('click', toggleFull);
  exitBtn.addEventListener('click', toggleFull);
  // "Chat with the AI coach" under the card opens the same demo full screen (its link to the demo page is the no-script fallback).
  $$('[data-cd-open]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); if (!isFull()) toggleFull(); }));
  document.addEventListener('fullscreenchange', fit);
  document.addEventListener('webkitfullscreenchange', fit);
  if ('ResizeObserver' in window) new ResizeObserver(fit).observe(screen); else addEventListener('resize', fit);
})();
</script>
"""

# Fitron Assistant, the chat in the corner of the page. Its markup, styles and script are real files next to this one
# (site-assistant.html, .css, .js) so they can be read and checked as what they are; the patch puts them between markers,
# and when they are already there it replaces what is between them, so a change to a source reaches the page by running
# this script again. The answers come from /api/assistant (src/app/api/assistant/route.ts); its suggested questions are the
# data-q buttons in the markup, which landing-page.test.ts keeps equal to SUGGESTED_QUESTIONS in src/lib/domain/assistant.ts.
HERE = os.path.dirname(os.path.abspath(__file__))


def source(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def put(page, anchor, block, start, end, why):
    """Put `block` between `start` and `end` before the first `anchor`; if it is already on the page, replace what is between them."""
    region = start + block + end
    found = re.compile(re.escape(start) + r"[\s\S]*?" + re.escape(end))
    if found.search(page):
        return found.sub(lambda _: region, page, count=1)
    assert anchor in page, f"{why}: anchor not found"
    return page.replace(anchor, region + anchor, 1)


ASSISTANT_CSS = "".join(line.strip() for line in source("site-assistant.css").splitlines())
ASSISTANT_HTML = source("site-assistant.html")
ASSISTANT_JS = "<script>\n" + source("site-assistant.js") + "</script>\n"

# On a phone the cookie banner and the WhatsApp button float above the open menu and cover its lower links.
MENU_CSS = "/*fitron:menu-over-banner*/body.menu-open .consent,body.menu-open .wa-float{opacity:0;visibility:hidden;pointer-events:none}"

# The page scrolls without a visible scrollbar, as the Fitron Assistant chat does.
SCROLLBAR_CSS = "/*fitron:no-page-scrollbar*/html{scrollbar-width:none}html::-webkit-scrollbar{display:none}"

# While the cookie banner is open, the WhatsApp button (bottom left) sits under it: completely at phone widths, where the
# banner spans the screen and the button shrinks to its icon, and partly up to about 1100 px, where the banner is centred
# but wide. The button waits until the visitor has chosen. (:has() needs a current browser; in an older one the rule is
# ignored and the overlap stays, as before.)
WA_BANNER_CSS = "/*fitron:wa-under-banner*/@media (max-width:1100px){body:has(.consent.show) .wa-float{opacity:0;visibility:hidden;pointer-events:none}}"

# The design's own phone rule `.hero{grid-template-columns:1fr}` is overridden by two later, unscoped
# `.hero{grid-template-columns:1.1fr .9fr}` rules, so on phones the hero stayed a two-column grid with an empty
# first column: the headline started 43 px in and ran 38 px past the right edge (and the 3D logo had no room).
# Selectors start with `body` so they win whatever their order. The floating cards are tucked inside the screen.
HERO_CSS = (
    "/*fitron:hero-phone*/@media (max-width:900px){"
    "body .hero{grid-template-columns:minmax(0,1fr)}body .hero-copy{min-width:0}body .hero .badge{white-space:normal}"
    "body .hero .hero-points{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:14px}}"
    "@media (max-width:520px){body .float-card.fc-1{left:0}body .float-card.fc-2{right:0}}"
)

# The pricing tab bar (AI Trainer | Gym Accounting | Gym Partnership) has labels that cannot wrap and was a fixed 359 px
# wide, so below about 360 px it ran off both sides of the screen (the first tab was cut off at 320 px) and at 375 px its
# border sat a few pixels past the edge. Fluid type and padding keep it inside the screen at every phone width.
TABS_CSS = (
    "/*fitron:tabs-phone*/@media (max-width:420px){body .seg.p-tabs{max-width:100%}"
    "body .seg.p-tabs label>span{font-size:clamp(.72rem,3.4vw,.82rem);padding-left:clamp(5px,2vw,13px);padding-right:clamp(5px,2vw,13px)}}"
)

# The floating WhatsApp link sat outside every landmark, which screen-reader users meet as stray content (axe "region").
WA_OPEN = '<aside aria-label="Quick contact">'

# Keyboard and screen-reader use of the phone menu. fitron-page.js opens it by toggling body.menu-open and closes it on
# Escape, but focus stayed on the button and Tab walked through the page hidden behind the menu. This watches the same
# class: when the menu opens, focus moves to its first link and the page behind (main, footer, the WhatsApp button) is
# made inert; when it closes the page is live again and focus goes back to the menu button, unless a link in the menu
# was chosen (then the browser has already moved focus to where that link leads).
MENU_JS = """<script>/*fitron:menu-a11y*/
(function () {
  var btn = document.querySelector('.menu-btn'), menu = document.getElementById('mobileMenu');
  if (!btn || !menu || !window.MutationObserver) return;
  var behind = [].slice.call(document.querySelectorAll('main, footer, .wa-float')), was = false, picked = false;
  menu.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) picked = true; });
  new MutationObserver(function () {
    var open = document.body.classList.contains('menu-open');
    if (open === was) return;
    was = open;
    behind.forEach(function (el) { if (open) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
    if (open) { var first = menu.querySelector('a'); if (first) first.focus({ preventScroll: true }); }
    else { var a = document.activeElement; if (!picked && (a === document.body || menu.contains(a))) btn.focus({ preventScroll: true }); }
    picked = false;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
</script>
"""

# The 3D logo is decoration. Its 1.2 MB library is not downloaded for visitors who asked for less motion or
# less data, and for everyone else it loads once the page has loaded and the browser is idle, so it no longer
# competes with the first paint.
BOOT_OLD = "import('/site/fitron-3d.js').then((m) => m.start(document.getElementById('scene'))).catch((e) => console.warn('[FITRON] 3D logo unavailable, showing the flat logo', e));"
BOOT_NEW = """const lite = matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator.connection && navigator.connection.saveData);
const load3d = () => import('/site/fitron-3d.js').then((m) => m.start(document.getElementById('scene'))).catch((err) => console.warn('[FITRON] 3D logo unavailable, showing the flat logo', err));
const later = () => ('requestIdleCallback' in window ? requestIdleCallback(load3d, { timeout: 3000 }) : setTimeout(load3d, 500));
if (!lite) { if (document.readyState === 'complete') later(); else addEventListener('load', later); }"""

# Prices are checked against src/lib/domain/pricing.ts by site-links.test.ts.
OFFERS = {
    "FITRON AI Trainer": [("AI Pro", 299), ("AI Premium", 499)],
    "FITRON Gym Accounting": [("Starter", 999), ("Professional", 1999), ("Enterprise", 3999)],
}


def faq(page):
    """(question, answer) for every item of the page's own FAQ, as plain text."""
    block = page[page.index('id="faq"'):]
    out = []
    for q, a in re.findall(r"<details><summary>(.*?)</summary><p>(.*?)</p></details>", block, re.S):
        text = lambda h: re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", h))).strip()
        out.append((text(q), text(a)))
    return out


def structured_data(page):
    org = {"@id": "https://fitron.in/#org"}
    apps = []
    for name, offers in OFFERS.items():
        ai = name.endswith("AI Trainer")
        apps.append({
            "@type": "SoftwareApplication",
            # Each product is described in full on its own page (src/app/(site)/gym-page.tsx and ai-personal-trainer/page.tsx).
            **({"@id": "https://fitron.in/ai-personal-trainer#software", "url": "https://fitron.in/ai-personal-trainer"} if ai else {"@id": "https://fitron.in/gym-accounting#software", "url": "https://fitron.in/gym-accounting"}),
            "name": name,
            "applicationCategory": "HealthApplication" if ai else "BusinessApplication",
            "operatingSystem": "Web",
            "publisher": org,
            "offers": [
                {"@type": "Offer", "name": n, "price": p, "priceCurrency": "INR",
                 "priceSpecification": {"@type": "UnitPriceSpecification", "price": p, "priceCurrency": "INR", "billingDuration": 1, "unitCode": "MON", "valueAddedTaxIncluded": True}}
                for n, p in offers
            ],
        })
    graph = [
        {"@type": "WebSite", "@id": "https://fitron.in/#website", "url": "https://fitron.in/", "name": "FITRON", "inLanguage": "en-IN", "publisher": org},
        {"@type": "Organization", "@id": "https://fitron.in/#org", "name": "FITRON", "url": "https://fitron.in/", "logo": "https://fitron.in/fitron-logo.png",
         "email": "hello@fitron.in", "telephone": "+91 62077 74673", "areaServed": "IN",
         "contactPoint": {"@type": "ContactPoint", "contactType": "customer support", "email": "hello@fitron.in", "telephone": "+91 62077 74673", "areaServed": "IN", "availableLanguage": "en"}},
        *apps,
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq(page)]},
    ]
    about = about_data()
    org_node = next(g for g in graph if g["@type"] == "Organization")
    if about["social"]:
        org_node["sameAs"] = [x["url"] for x in about["social"]]
    if about["founders"]:
        org_node["founder"] = [{"@type": "Person", "name": x["name"], **({"url": x["url"]} if x.get("url") else {})} for x in about["founders"]]
    body = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False).replace("</", "<\\/")
    return f'<script type="application/ld+json">{body}</script>\n'


# Old swaps whose text lives in a region that the redesign replaces as a whole (see REDESIGN below).
REPLACED = {
    **{w: "faq" for w in ["FAQ question", "FAQ answer", "FAQ answer: GST is optional", "FAQ: GST link", "FAQ: branches link", "FAQ: available now, how to pay",
                          "FAQ: free trial, how to pay", "FAQ: cancelling", "FAQ: data", "FAQ: AI trainer link"]},
    "Gym Accounting card": "gym-checks",
    "Gym Accounting card: module count": "gym-checks",
    **{w: "footer" for w in ["footer links to the Gym Accounting pages", "footer: AI Trainer link"]},
}

SUPERSEDED = {"page title", "meta description", "link preview title", "AI Trainer card: details link", "Gym Accounting card: Demo product (opens the live demo full screen; the link is the no-script fallback)"}

CHECK_ITEM = '<li><svg class="icon"><use href="#i-check"></use></svg><span>{}</span></li>'
PREMIUM_LIST = re.compile(r'(<li class="pc-inc">Everything in AI Pro, plus</li>)(?:<li><svg class="icon"><use href="#i-check"></use></svg><span>[^<]*</span></li>)+(</ul>)')


# ---- Redesign: the sections, header, footer and consent panel of the brief. -------------------------------------------------
# Their markup, styles and script are real files in scripts/site/ (hero.html, showcase.html, nav.html ...). Each is put
# between <!--fitron:name--> markers: the first run replaces the design's own markup, later runs refresh what is between the
# markers, so editing a file there and running this script again is all it takes.
SITE_DIR = os.path.join(HERE, "site")


def site_src(name):
    with open(os.path.join(SITE_DIR, name), encoding="utf-8") as f:
        return f.read()


def region(page, original, block, name, why):
    """Replace the design's `original` markup (a regex) by `block` between markers; refresh the block if the markers are there."""
    start, end = f"<!--fitron:{name}-->", f"<!--/fitron:{name}-->"
    found = re.compile(re.escape(start) + r"[\s\S]*?" + re.escape(end))
    if found.search(page):
        return found.sub(lambda _: start + block + end, page, count=1)
    page, n = re.subn(original, lambda _: start + block + end, page, count=1, flags=re.S)
    assert n == 1, f"{why}: the markup to replace was not found"
    return page


def squash_css(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    return "".join(line.strip() for line in css.splitlines())


AI_FEATURES = ["Personalized 4-week workout plans", "Home or gym workouts", "Indian meal plans", "Diet preferences", "Budget-aware meals",
               "24/7 AI coach", "Habit tracking", "Water tracking", "Progress tracking", "Weekly review"]
GYM_FEATURES = ["Member management", "Membership plans", "Fee collection", "GST invoices", "Expenses", "Profit &amp; loss",
                "WhatsApp reminders", "Staff management", "Excel/CSV export", "Multi-branch support"]


def checks(items):
    return '<ul class="checks two">' + "".join(CHECK_ITEM.format(i) for i in items) + "</ul>"


def about_data():
    """The owner's real profiles, from src/lib/domain/about-data.json (empty until they are supplied)."""
    with open(os.path.join(HERE, "..", "src", "lib", "domain", "about-data.json"), encoding="utf-8") as f:
        return json.load(f)


def social_html():
    links = "".join(f'<a href="{htmllib.escape(x["url"])}" rel="me noopener" target="_blank">{htmllib.escape(x["network"])}</a>' for x in about_data()["social"])
    return links


def redesign(page):
    page = region(page, r'<header class="nav" id="nav">.*?</header>\s*<nav class="mobile-menu".*?</nav>\n', site_src("nav.html"), "nav", "header and phone menu")
    page = region(page, r'<div class="hero-wrap" id="top">.*?(?=\s*<section class="band")', site_src("hero.html"), "hero", "hero")
    page = put(page, '<section class="section" id="together"', site_src("showcase.html") + "\n  ", "<!--fitron:showcase-->", "<!--/fitron:showcase-->", "showcase sections")
    page = region(page, r'<div class="together reveal">.*?(?=\s*<div class="result reveal")', site_src("together.html"), "together", "Better together flow")
    page = put(page, '</section>\n\n  <section class="section" id="pricing"', site_src("partner-extras.html"), "<!--fitron:partner-models-->", "<!--/fitron:partner-models-->", "partner models")
    page = put(page, '\n\n  <section class="section" id="pricing"', site_src("partner-earnings.html"), "<!--fitron:partner-earnings-->", "<!--/fitron:partner-earnings-->", "how the partnership works")
    page = put(page, '      </div>\n      <div class="p-panel p-acc" id="pricing-accounting">', site_src("compare-ai.html"), "<!--fitron:compare-ai-->", "<!--/fitron:compare-ai-->", "AI plan table")
    page = put(page, '<p class="p-fine">*WhatsApp messaging', site_src("compare-gym.html"), "<!--fitron:compare-gym-->", "<!--/fitron:compare-gym-->", "gym plan table")
    page = region(page, r'<div class="faq reveal">.*?</div>(?=\s*</section>)', site_src("faq.html"), "faq", "FAQ")
    page = region(page, r"<footer id=\"siteEnd\">.*?</footer>", site_src("footer.html").replace("@@SOCIAL@@", social_html()), "footer", "footer")
    page = region(page, r'<div class="consent" id="consent".*?</div>\n</div>', site_src("consent.html"), "consent", "cookie banner")
    page = region(page, r'<ul class="checks">.*?</ul>', checks(AI_FEATURES), "ai-checks", "AI Trainer card features")
    page = region(page, r'<ul class="checks">.*?</ul>', checks(GYM_FEATURES) + '<p class="sc-fine" style="text-align:left;margin-top:12px">Some features need the Professional or Enterprise plan. <a href="#pricing">Compare plans</a>.</p>', "gym-checks", "Gym Accounting card features")
    page = put(page, "</head>", "<style>" + squash_css(site_src("redesign.css")) + "</style>", "<!--fitron:redesign-css-->", "<!--/fitron:redesign-css-->", "redesign styles")
    page = put(page, "</body>", "<script>\n" + site_src("extras.js") + "</script>\n", "<!--fitron:extras-->", "<!--/fitron:extras-->", "redesign script")
    page = add(page, "</body>", '<script src="/site/analytics.js" defer></script>\n', 'src="/site/analytics.js"', "analytics loader (consent-gated, see public/site/analytics.js)", before=True)
    # The hero's biggest picture is asked for at the very top of the page, before the long inline styles, so it is not the last thing to arrive.
    OLD_PRELOAD = '<link rel="preload" as="image" href="/site/console-dashboard.webp" imagesrcset="/site/console-dashboard-700.webp 700w, /site/console-dashboard.webp 1400w" imagesizes="(max-width: 900px) 260px, 380px" fetchpriority="high">'
    NEW_PRELOAD = '<link rel="preload" as="image" href="/site/gym-dashboard.webp" imagesrcset="/site/gym-dashboard-720.webp 720w, /site/gym-dashboard.webp 1440w" imagesizes="(max-width: 900px) 92vw, 520px" fetchpriority="high">'
    page = add(page, '<meta charset="utf-8">', "\n" + NEW_PRELOAD, 'rel="preload" as="image"', "preload of the hero screenshot")
    # The hero shows the laptop's own 16:10 capture of the dashboard now (the old preload named the cropped screenshot).
    page = swap(page, OLD_PRELOAD, NEW_PRELOAD, "preload of the hero screenshot: laptop capture")
    page = add(
        page, '<meta name="twitter:card" content="summary_large_image">',
        '\n<meta name="twitter:title" content="FITRON — AI Personal Trainer &amp; Gym Accounting Software">\n<meta name="twitter:description" content="An AI personal trainer from ₹299 a month and gym accounting software from ₹999 a month, in one platform. 7-day free trial.">\n<meta name="twitter:image" content="https://fitron.in/site/og.png">',
        'name="twitter:title"', "twitter card details",
    )
    return page


def apply(page):
    # The structured data repeats the FAQ answers word for word and is rebuilt at the end from the patched page, so it is
    # taken out first: a swap below must find the text once, not once in the page and once in the structured data.
    page = re.sub(r'<script type="application/ld\+json">.*?</script>\n', "", page, flags=re.S)
    for old, new, why in TEXT:
        # Text inside a region the redesign replaces (the FAQ, the footer) is not looked for once that region is in place.
        if why in REPLACED and f"<!--fitron:{REPLACED[why]}-->" in page:
            continue
        # Steps the redesign continues from (title, card buttons) are only the first half of a chain: once it is in, skip them.
        if why in SUPERSEDED and "<!--fitron:hero-->" in page:
            continue
        page = swap(page, old, new, why)
    # The design hid the hero pictures on phones shorter than 760 px, which is most real phones (browser bars eat the height).
    page = swap(page, "@media (max-width:900px) and (max-height:760px){.hero-visual{display:none}}\n", "", "hero pictures stay on short phones")
    # Premium lists only what the app really gates by tier. Applying this again gives the same list.
    page, n = PREMIUM_LIST.subn(lambda m: m.group(1) + CHECK_ITEM.format("AI Coach: 100 messages a day") + m.group(2), page)
    assert n == 1, "AI Premium list not found"
    # Real alt text on the AI Trainer screenshot (the file may be .png or .webp).
    page, n = re.subn(r'(<img data-gallery-img="" src="[^"]+") alt="[^"]*"', lambda m: f'{m.group(1)} alt="{ALT}"', page)
    assert n == 1 and f'alt="{ALT}"' in page, "AI Trainer screenshot not found"
    page = add(page, "</style>", MENU_CSS, "fitron:menu-over-banner", "menu over banner", before=True)
    page = add(page, "</style>", SCROLLBAR_CSS, "fitron:no-page-scrollbar", "no page scrollbar", before=True)
    page = add(page, "</style>", WA_BANNER_CSS, "fitron:wa-under-banner", "WhatsApp button under the cookie banner", before=True)
    page = add(page, "</style>", HERO_CSS, "fitron:hero-phone", "hero on phones", before=True)
    page = add(page, "</style>", TABS_CSS, "fitron:tabs-phone", "pricing tabs on phones", before=True)
    # Wrap the WhatsApp link in a landmark (once).
    if WA_OPEN + '<a class="wa-float"' not in page:
        page, n = re.subn(r'(<a class="wa-float"[\s\S]*?</a>)', lambda m: WA_OPEN + m.group(1) + "</aside>", page, count=1)
        assert n == 1, "WhatsApp link not found"
    page = add(page, "</body>", MENU_JS, "fitron:menu-a11y", "menu keyboard focus", before=True)
    if "const webgl" not in page:  # the first half of a chain that the TEXT entries above carry on
        page = swap(page, BOOT_OLD, BOOT_NEW, "3D logo loading")
    for old, new, why in BOOT_STEPS:
        page = swap(page, old, new, why)
    if 'class="ld-poster" loading="lazy"' not in page:  # the first half of a chain that LATE_STEPS carries on
        page = swap(page, LIVE_DEMO_OLD, LIVE_DEMO_NEW, "Gym Accounting card: live demo")
    for old, new, why in LATE_STEPS:
        page = swap(page, old, new, why)
    page = swap(page, COACH_DEMO_OLD, COACH_DEMO_NEW, "AI Trainer card: live coach demo")
    page = swap(page, COACH_CTA_OLD, COACH_CTA_NEW, "AI Trainer card: link to the coach demo")
    page = add(page, '  <symbol id="i-close"', LIVE_DEMO_ICONS, '<symbol id="i-play"', "live demo icons", before=True)
    page = add(page, "</style>", LIVE_DEMO_CSS, "fitron:live-demo*/", "live demo styles", before=True)
    page = add(page, "</body>", LIVE_DEMO_JS, "fitron:live-demo-js", "live demo script", before=True)
    page = add(page, "</style>", COACH_DEMO_CSS, "fitron:coach-demo*/", "coach demo styles", before=True)
    page = add(page, "</body>", COACH_DEMO_JS, "fitron:coach-demo-js", "coach demo script", before=True)
    page = put(page, "</style>", ASSISTANT_CSS, "/*fitron:assistant*/", "/*fitron:assistant-end*/", "Fitron Assistant styles")
    page = put(page, "</body>", ASSISTANT_HTML + ASSISTANT_JS, "<!--fitron:assistant-->", "<!--/fitron:assistant-->", "Fitron Assistant chat")
    # The guides for gym owners (src/lib/domain/guides.ts), at the end of the footer links.
    if "<!--fitron:footer-->" not in page:
        page = swap(page, '<li><a href="#faq">FAQ</a></li></ul>', '<li><a href="#faq">FAQ</a></li><li><a href="/guides">Guides for gym owners</a></li></ul>', "footer: guides link")
    page = add(page, '<link rel="apple-touch-icon" href="/fitron-mark.png">', '\n<link rel="manifest" href="/manifest.webmanifest">', 'rel="manifest"', "web app manifest (src/app/manifest.ts)")
    if "<!--fitron:footer-->" not in page:
        page = add(page, '<li><a href="/contact">Contact us</a></li>', '\n      <li><a href="/contact#company">Company details</a></li>', "/contact#company", "footer company link")
    page = redesign(page)
    # Rebuilt each time, so a changed FAQ or price list reaches the structured data.
    page = re.sub(r'<script type="application/ld\+json">.*?</script>\n', "", page, flags=re.S)
    page = add(page, "</head>", structured_data(page), "@@never@@", "structured data", before=True)
    return page


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else PAGE
    before = open(path, encoding="utf-8").read()
    after = apply(before)
    if after == before:
        print("Already up to date:", os.path.normpath(path))
    else:
        open(path, "w", encoding="utf-8").write(after)
        print("Patched", os.path.normpath(path))
