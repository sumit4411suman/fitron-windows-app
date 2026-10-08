/* FITRON site analytics: Google Analytics 4 events, only for visitors who said yes to analytics.
 *
 * - Nothing is loaded or sent until the visitor ticks "Analytics" in the cookie choices (stored in localStorage under
 *   `fitron-site-consent`, written by the banner on the home page and by the one on the other public pages).
 * - The measurement ID is not in this file: it comes from the server (GA_MEASUREMENT_ID, /api/analytics-config), so a
 *   deployment without one loads nothing at all.
 * - Events (docs/ANALYTICS.md): add data-track="event_name" (and data-track-from="where") to any link or button. Links to
 *   WhatsApp, e-mail, sign-in, the plans and the partner/demo contact topics are named automatically.
 * - window.fitronTrack(name, params) is for pages that fire an event themselves (the contact form).
 */
(function () {
  'use strict';
  var KEY = 'fitron-site-consent';
  var id = null, started = false, ready = false, queue = [];

  function allowed() {
    try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); return !!(c && c.analytics); } catch { return false; }
  }
  function gtag() { (window.dataLayer = window.dataLayer || []).push(arguments); }

  function track(name, params) {
    if (!allowed()) return;
    if (!ready) { if (queue.length < 30) queue.push([name, params || {}]); return; }
    gtag('event', name, params || {});
  }
  window.fitronTrack = track;

  function start() {
    if (started || !allowed()) return;
    started = true;
    fetch('/api/analytics-config', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (cfg) {
        if (!cfg || !/^G-[A-Z0-9]{4,}$/.test(cfg.id || '')) return;
        id = cfg.id;
        window.dataLayer = window.dataLayer || [];
        gtag('js', new Date());
        // No ad features and no signals: this is measurement only.
        gtag('config', id, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
        document.head.appendChild(s);
        ready = true;
        queue.splice(0).forEach(function (q) { gtag('event', q[0], q[1]); });
      })
      .catch(function () { /* analytics is optional: a failure changes nothing for the visitor */ });
  }

  function stop() {
    if (id) window['ga-disable-' + id] = true;
    queue.length = 0;
    // Forget the Google Analytics cookies this site set.
    document.cookie.split(';').forEach(function (c) {
      var n = c.split('=')[0].trim();
      if (n === '_ga' || n.indexOf('_ga_') === 0) document.cookie = n + '=; path=/; max-age=0; domain=' + location.hostname.replace(/^www\./, '.');
    });
  }

  window.addEventListener('fitron:consent', function () { if (allowed()) { if (id) window['ga-disable-' + id] = false; start(); } else stop(); });
  start();

  // Which event does a click mean? An explicit data-track wins; otherwise the link says it.
  function nameOf(a) {
    var t = a.getAttribute('data-track');
    if (t) return t;
    var href = a.getAttribute('href') || '';
    if (/^https:\/\/wa\.me\//.test(href)) return 'whatsapp_click';
    if (/^mailto:/.test(href)) return 'email_click';
    if (href === '/signin' || /^\/signin[?#]/.test(href)) return 'signin_click';
    var plan = /[?&]plan=([a-z-]+)/.exec(href);
    if (/^\/signup/.test(href) && plan) {
      if (/^ai-/.test(plan[1])) return 'start_ai_trial';
      if (/^partner-/.test(plan[1])) return 'partner_lead';
      return 'start_gym_trial';
    }
    var topic = /^\/contact[?&#].*topic=([a-z]+)/.exec(href);
    if (topic) return topic[1] === 'partner' ? 'partner_lead' : topic[1] === 'demo' ? 'demo_request' : null;
    return null;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a,button');
    if (!a) return;
    var name = nameOf(a);
    var inPricing = a.closest && a.closest('#pricing');
    var p = { location: a.getAttribute('data-track-from') || (inPricing ? 'pricing' : 'page'), link_url: a.getAttribute('href') || undefined };
    if (name) track(name, p);
    if (inPricing && a.classList.contains('pc-cta')) track('pricing_click', { plan: (a.closest('article').querySelector('h3') || {}).textContent, link_url: p.link_url });
  }, true);

  // FAQ questions opened (the toggle event does not bubble, so it is caught on the way down).
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.tagName === 'DETAILS' && d.open && d.parentNode && d.closest('.faq')) track('faq_interaction', { question: (d.querySelector('summary') || {}).textContent });
  }, true);

  // The pricing section came into view, once.
  var pricing = document.getElementById('pricing');
  if (pricing && 'IntersectionObserver' in window) {
    var po = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { po.disconnect(); track('pricing_view'); } }, { threshold: 0.3 });
    po.observe(pricing);
  }

  // A guide that was read: 75% of the way down.
  if (/^\/guides\/[^/]+/.test(location.pathname)) {
    var done = false;
    addEventListener('scroll', function () {
      if (done) return;
      var h = document.documentElement;
      if ((scrollY + innerHeight) / h.scrollHeight > 0.75) { done = true; track('guide_engaged', { page_path: location.pathname }); }
    }, { passive: true });
  }
})();
