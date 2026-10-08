// Shared interactions for FITRON product pages (subset of fitron-site.js; every part is optional).
export function init() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  document.documentElement.classList.add('js');

  const nav = $('#nav'), menuBtn = $('.menu-btn');
  if (menuBtn) {
    const setMenu = (open) => { document.body.classList.toggle('menu-open', open); menuBtn.setAttribute('aria-expanded', String(open)); document.body.style.overflow = open ? 'hidden' : ''; };
    menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
    $$('#mobileMenu a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  }

  const revealEls = $$('.reveal, .reveal-3d');
  if (reduce || !('IntersectionObserver' in window)) revealEls.forEach((el) => el.classList.add('in'));
  else {
    const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach((el) => io.observe(el));
  }

  if (finePointer && !reduce) {
    $$('[data-tilt]').forEach((el) => {
      let raf = 0;
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          el.classList.add('tilting');
          el.style.setProperty('--rx', ((0.5 - y) * 9).toFixed(2) + 'deg'); el.style.setProperty('--ry', ((x - 0.5) * 11).toFixed(2) + 'deg');
          el.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
        });
      });
      el.addEventListener('pointerleave', () => { cancelAnimationFrame(raf); el.classList.remove('tilting'); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
    });
    const hv = $('#heroVisual');
    if (hv) addEventListener('pointermove', (e) => { hv.style.setProperty('--mx', (e.clientX / innerWidth - 0.5).toFixed(3)); hv.style.setProperty('--my', (e.clientY / innerHeight - 0.5).toFixed(3)); }, { passive: true });
  }

  // billing toggles: card[data-bill-name] with input[name] month|year; price data lives here so markup stays simple
  const PRICES = {"aipro":{"month":{"amt":"299","per":"/ month","note":"7-day free trial · then billed monthly"},"year":{"amt":"1,999","per":"/ year","note":"Save ₹1,589 vs 12 monthly payments"}},"aiprem":{"month":{"amt":"499","per":"/ month","note":"7-day free trial · then billed monthly"},"year":{"amt":"4,999","per":"/ year","note":"Save ₹989 vs 12 monthly payments"}},"acs":{"month":{"amt":"999","per":"/ month","note":"Up to 100 active members · 7-day free trial"},"year":{"amt":"9,990","per":"/ year","note":"Up to 100 active members · 2 months free"}},"acp":{"month":{"amt":"1,999","per":"/ month","note":"Up to 300 active members · 7-day free trial"},"year":{"amt":"19,990","per":"/ year","note":"Up to 300 active members · 2 months free"}},"ace":{"month":{"amt":"3,999","per":"/ month","note":"Unlimited members · 7-day free trial"},"year":{"amt":"39,990","per":"/ year","note":"Unlimited members · 2 months free"}}};
  const applyBill = (card, k) => { const prices = PRICES[card.dataset.billName]; const p = prices && prices[k]; if (!p) return; const amt = $('[data-amt]', card), per = $('[data-per]', card), note = $('[data-note]', card); if (amt) amt.innerHTML = '<span class="rs">₹</span>' + p.amt; if (per) per.textContent = p.per; if (note) note.textContent = p.note; };
  try {
    $$('[data-bill-name]').forEach((card) => { $$('input[name="' + card.dataset.billName + '"]', card).forEach((r) => r.addEventListener('change', () => applyBill(card, r.value))); });
    $$('input[name="billall"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) $$('[data-bill-name]').forEach((card) => applyBill(card, r.value)); }));
  } catch (err) { console.warn('[FITRON] pricing toggles', err); }

  // cross-page links: when the sibling pages are not shipped (single-file artifact), fall back to in-page targets
  try {
    const probe = new Map();
    $$('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!/\.dc\.html|^gym-accounting\//.test(href) || /^https?:/.test(href)) return;
      const file = href.split('#')[0];
      if (!probe.has(file)) probe.set(file, location.protocol === 'file:' ? Promise.resolve(false) : fetch(file, { method: 'HEAD' }).then((r) => r.ok).catch(() => false));
      probe.get(file).then((ok) => { if (ok) return; a.setAttribute('href', a.dataset.fallback || (/gym-accounting|Gym Accounting/.test(href) ? 'https://wa.me/916207774673?text=Hi%20FITRON%2C%20I%20want%20to%20start%20the%20Gym%20Accounting%20free%20trial.' : '#pricing')); if (/^https?:/.test(a.getAttribute('href'))) a.setAttribute('target', '_blank'); else a.removeAttribute('target'); });
    });
  } catch (err) { console.warn('[FITRON] link probe', err); }

  // screen gallery: [data-gallery] holds img[data-gallery-img] + button[data-src]
  try {
    $$('[data-gallery]').forEach((g) => {
      const img = $('[data-gallery-img]', g), btns = $$('button[data-src]', g);
      btns.forEach((b) => b.addEventListener('click', () => { img.style.opacity = '0'; setTimeout(() => { img.src = b.dataset.src; img.alt = b.dataset.alt || b.textContent.trim(); img.style.opacity = '1'; }, 180); btns.forEach((x) => x.classList.toggle('active', x === b)); }));
    });
  } catch (err) { console.warn('[FITRON] gallery', err); }

  // tabbed showcase: [data-tabs] with .gym-tab buttons and .cview panels
  $$('[data-tabs]').forEach((box) => {
    const tabs = $$('.gym-tab', box), views = $$('.cview', box), title = $('[data-tab-title]', box);
    let i = 0, auto = !reduce;
    if (!auto) box.classList.add('manual');
    const show = (k, byUser) => {
      i = (k + tabs.length) % tabs.length;
      tabs.forEach((t, j) => { const on = j === i; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
      views.forEach((v, j) => v.classList.toggle('active', j === i));
      if (title) title.textContent = tabs[i].dataset.title || $('.gt-text b', tabs[i]).textContent;
      if (byUser && auto) { auto = false; box.classList.add('manual'); }
    };
    tabs.forEach((t, k) => { t.addEventListener('click', () => show(k, true)); const bar = $('.gt-bar i', t); if (bar) bar.addEventListener('animationend', () => { if (auto) show(i + 1); }); });
    box.classList.add('paused');
    new IntersectionObserver((es) => box.classList.toggle('paused', !es[0].isIntersecting), { threshold: 0.35 }).observe(box);
    box.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') box.classList.add('hovering'); });
    box.addEventListener('pointerleave', () => box.classList.remove('hovering'));
  });

  // lazy iframe demo
  const demoBody = $('#demoBody');
  if (demoBody) {
    let done = false;
    const launch = () => {
      if (done) return; done = true;
      const empty = demoBody.querySelector('.demo-empty');
      const f = document.createElement('iframe');
      f.src = demoBody.dataset.src + '?r=' + Date.now(); f.title = 'Fitron Gym Accounting live demo'; f.className = 'demo-frame'; f.style.opacity = '0';
      demoBody.appendChild(f);
      let waited = 0;
      const poll = setInterval(() => {
        waited += 500; let ready = false;
        try { const t = f.contentDocument && f.contentDocument.body ? f.contentDocument.body.innerText : ''; ready = /Dashboard|Members|Sign in/i.test(t) && !/Unpacking/i.test(t); } catch (e) { ready = waited > 4000; }
        if (ready || waited > 25000) { clearInterval(poll); f.style.transition = 'opacity .5s'; f.style.opacity = '1'; if (empty) empty.remove(); }
      }, 500);
    };
    new IntersectionObserver((es, obs) => { if (!es[0].isIntersecting) return; obs.disconnect(); setTimeout(launch, 150); }, { rootMargin: '300px 0px' }).observe(demoBody);
  }

  // steps progress
  const steps = $('#steps'), stepEls = steps ? $$('.step', steps) : [];
  const bar = $('.progress span');
  const consoleWrap = $('#consoleWrap');
  const onScroll = () => {
    const y = scrollY, vh = innerHeight;
    if (nav) nav.classList.toggle('scrolled', y > 20);
    document.querySelectorAll('.scroll-cue').forEach((c) => c.classList.toggle('gone', y > 40));
    if (bar) bar.style.transform = 'scaleX(' + clamp(y / (document.documentElement.scrollHeight - vh)).toFixed(4) + ')';
    if (steps) { const sr = steps.getBoundingClientRect(); const sp = reduce ? 1 : clamp((vh * 0.72 - sr.top) / (sr.height * 0.9)); steps.style.setProperty('--p', sp.toFixed(3)); stepEls.forEach((s, i) => s.classList.toggle('on', sp >= i / stepEls.length + 0.02 || sp >= 0.98)); }
    if (consoleWrap) { const cr = consoleWrap.getBoundingClientRect(); consoleWrap.style.setProperty('--p', (reduce ? 1 : clamp((vh - cr.top) / (vh * 0.8))).toFixed(3)); }
  };
  let raf = 0;
  addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(onScroll); }, { passive: true });
  addEventListener('resize', onScroll); onScroll();

  // cookie consent
  const consent = $('#consent'), CKEY = 'fitron-site-consent';
  if (consent) {
    let stored = null; try { stored = JSON.parse(localStorage.getItem(CKEY) || 'null'); } catch (_) {}
    if (!stored) setTimeout(() => consent.classList.add('show'), 1200);
    $$('[data-consent]').forEach((b) => b.addEventListener('click', () => { try { localStorage.setItem(CKEY, JSON.stringify({ choice: b.dataset.consent, at: new Date().toISOString() })); } catch (_) {} consent.classList.remove('show'); }));
    $$('[data-cookie-settings]').forEach((b) => b.addEventListener('click', () => consent.classList.add('show')));
  }
}
