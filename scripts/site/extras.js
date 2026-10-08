/*fitron:extras*/
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // The diet and workout samples: one panel shows at a time. Without scripts the first panel of each shows.
  function tabs(rootSel, attr, name) {
    var root = $(rootSel);
    if (!root) return;
    var show = function (v) { $$('[data-' + attr + ']', root).forEach(function (p) { p.hidden = p.getAttribute('data-' + attr) !== v; }); };
    $$('input[name="' + name + '"]', root).forEach(function (r) { r.addEventListener('change', function () { if (r.checked) show(r.value); }); });
    var on = $('input[name="' + name + '"]:checked', root);
    if (on) show(on.value);
  }
  tabs('#dietTabs', 'diet', 'diet');
  tabs('#wkTabs', 'where', 'wkwhere');

  // "See plan" links in the partnership section open the Gym Partnership tab of the pricing table.
  $$('[data-pricing-tab]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var r = document.getElementById('pt-' + a.getAttribute('data-pricing-tab'));
      var target = document.getElementById('pricing');
      if (!r || !target) return;
      e.preventDefault();
      r.checked = true;
      r.dispatchEvent(new Event('change', { bubbles: true }));
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  });

  // "What your gym could earn": members × the gym's share of one month of the plan (paise, on the section; the
  // landing-page test keeps them equal to PLANS and PARTNER_SHARE). Without scripts it shows the figures for 50 on AI Pro.
  var pe = $('#partner-earnings'), peN = $('#peN');
  if (pe && peN) {
    var rupees = function (paise) { return '≈ <span class="rs">₹</span>' + Math.round(paise / 100).toLocaleString('en-IN'); };
    var calc = function () {
      var plan = ($('input[name="peplan"]:checked', pe) || {}).value === 'premium' ? 'premium' : 'pro';
      var n = Number(peN.value) || 0, share = Number(pe.getAttribute('data-' + plan)) || 0;
      $('#peNOut').textContent = String(n);
      $('#peMonth').innerHTML = rupees(n * share);
      $('#peYear').innerHTML = rupees(n * share * 12);
    };
    peN.addEventListener('input', calc);
    $$('input[name="peplan"]', pe).forEach(function (r) { r.addEventListener('change', calc); });
    calc();
  }

  // The Partner Console live demo (#partnerDemo): the page loads into the phone only when its button is pressed.
  var pd = $('#partnerDemo');
  if (pd) $('[data-pd-play]', pd).addEventListener('click', function () {
    if (pd.classList.contains('running')) return;
    var f = document.createElement('iframe');
    f.title = 'FITRON Partner Console live demo'; f.src = pd.getAttribute('data-src');
    pd.appendChild(f); pd.classList.add('running'); f.focus();
  });

  // The 3D logo (decoration) shows only while the closing call to action is on screen.
  var cta = $('#join');
  if (cta && 'IntersectionObserver' in window) new IntersectionObserver(function (es) { document.body.classList.toggle('logo-on', es[0].isIntersecting); }, { threshold: 0.3, rootMargin: '0px 0px -30% 0px' }).observe(cta);

  // Cookie choices. The consent is kept in localStorage under the key the page has always used; `analytics` and
  // `preferences` are new. Nothing that is not essential runs unless its box was ticked (see /analytics.js).
  var KEY = 'fitron-site-consent', box = $('#consent');
  if (!box) return;
  var panel = $('#consentPanel'), manage = $('[data-consent-manage]', box), prefs = $('#consentPrefs'), ana = $('#consentAnalytics');
  var read = function () { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  var save = function (c) {
    var v = { choice: c.choice, analytics: !!c.analytics, preferences: !!c.preferences, at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked: the choice lasts for this page only */ }
    box.classList.remove('show');
    if (panel) { panel.hidden = true; if (manage) manage.setAttribute('aria-expanded', 'false'); }
    window.dispatchEvent(new CustomEvent('fitron:consent', { detail: v }));
  };
  // Capture phase: these buttons are ours, so the design's older two-button handler never sees the click.
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-consent],[data-consent-manage],[data-consent-save],[data-cookie-settings]');
    if (!t) return;
    if (t.hasAttribute('data-consent')) { e.stopImmediatePropagation(); var all = t.getAttribute('data-consent') === 'all'; save({ choice: all ? 'all' : 'essential', analytics: all, preferences: all }); }
    else if (t.hasAttribute('data-consent-save')) { e.stopImmediatePropagation(); save({ choice: 'custom', analytics: ana.checked, preferences: prefs.checked }); }
    else if (t.hasAttribute('data-consent-manage')) {
      e.stopImmediatePropagation();
      panel.hidden = !panel.hidden;
      manage.setAttribute('aria-expanded', String(!panel.hidden));
    } else if (t.hasAttribute('data-cookie-settings')) {
      var c = read() || {};
      ana.checked = !!c.analytics; prefs.checked = !!c.preferences;
    }
  }, true);
})();
