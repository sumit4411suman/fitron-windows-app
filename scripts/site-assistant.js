(function () {
  // Fitron Assistant (#fitronAssistant): the chat in the corner of the page. It posts the conversation to /api/assistant
  // (src/app/api/assistant/route.ts), which answers from FITRON's own facts. The conversation is kept in this tab's
  // sessionStorage so it survives a visit to another page of the site; nothing is stored on the server. Answers are built
  // with DOM nodes (textContent), never from the answer's text as HTML, and only links to our own pages and WhatsApp are clickable.
  var root = document.getElementById('fitronAssistant');
  if (!root) return;
  var $ = function (s) { return root.querySelector(s); };
  var launcher = $('.fa-launcher'), panel = $('.fa-panel'), log = $('.fa-log'), form = $('.fa-form');
  var input = $('.fa-input'), send = $('.fa-send'), closeBtn = $('.fa-close');
  var KEY = 'fitron-assistant-v1', API = '/api/assistant', KEEP = 20;
  var phone = matchMedia('(max-width:640px)');
  var turns = [], busy = false, typingEl = null;

  var PAGES = 'signup|signin|login|trainer|contact|privacy|terms|refund|forgot-password|gym-accounting|gym-management-software|gym-gst-billing|ai-personal-trainer|guides';
  var PAGE_AT = new RegExp('^/(?:' + PAGES + ')(?=$|[/?#])');
  var TOKEN = new RegExp('\\*\\*([^*]+)\\*\\*|\\[([^\\]]+)\\]\\(([^)\\s]+)\\)|(https://[^\\s<>()]+)|(/(?:' + PAGES + ')(?![\\w-])[^\\s<>()]*)|([\\w.+-]+@fitron\\.in)', 'g');

  function safeHref(u) {
    if (PAGE_AT.test(u) || /^https:\/\/(?:fitron\.in|wa\.me)\//.test(u)) return u;
    return null;
  }

  function link(parent, label, href) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (/^https:\/\/wa\.me\//.test(href)) { a.target = '_blank'; a.rel = 'noopener'; }
    parent.appendChild(a);
  }

  // One line of an answer: **bold**, [text](address), plain addresses and paths of our pages, and hello@fitron.in.
  function inline(parent, text) {
    var last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      last = m.index + m[0].length;
      if (m[1]) { var b = document.createElement('strong'); b.textContent = m[1]; parent.appendChild(b); continue; }
      if (m[2]) {
        var h = safeHref(m[3]);
        if (h) link(parent, m[2], h); else parent.appendChild(document.createTextNode(m[2]));
        continue;
      }
      var u = m[4] || m[5] || m[6], tail = '', t = u.match(/[.,;:!?]+$/);
      if (t) { tail = t[0]; u = u.slice(0, -tail.length); }
      var href = m[6] ? 'mailto:' + u : safeHref(u);
      if (href) link(parent, u.replace(/^https:\/\//, ''), href); else parent.appendChild(document.createTextNode(u));
      if (tail) parent.appendChild(document.createTextNode(tail));
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  // Paragraphs, and "- " lines as a list.
  function render(el, text) {
    var ul = null;
    text.split('\n').forEach(function (line) {
      var t = line.trim();
      if (!t) { ul = null; return; }
      var item = t.match(/^[-•*]\s+(.*)$/);
      if (item) {
        if (!ul) { ul = document.createElement('ul'); el.appendChild(ul); }
        var li = document.createElement('li');
        inline(li, item[1]);
        ul.appendChild(li);
      } else {
        ul = null;
        var p = document.createElement('p');
        inline(p, t);
        el.appendChild(p);
      }
    });
  }

  function toEnd() { log.scrollTop = log.scrollHeight; }

  function bubble(role, text, extra) {
    var d = document.createElement('div');
    d.className = 'fa-msg ' + (role === 'user' ? 'fa-me' : 'fa-bot') + (extra ? ' ' + extra : '');
    if (role === 'user') d.textContent = text; else render(d, text);
    log.appendChild(d);
    toEnd();
    return d;
  }

  function typing(on) {
    if (on && !typingEl) {
      typingEl = document.createElement('div');
      typingEl.className = 'fa-msg fa-bot fa-typing';
      typingEl.innerHTML = '<i></i><i></i><i></i><span class="fa-sr">Fitron Assistant is typing</span>';
      log.appendChild(typingEl);
      toEnd();
    } else if (!on && typingEl) {
      typingEl.remove();
      typingEl = null;
    }
  }

  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-KEEP))); } catch (e) { /* storage blocked: the chat just starts fresh next time */ } }

  function dropChips() { var c = $('.fa-chips'); if (c) c.remove(); }

  function restore() {
    var saved = [];
    try { saved = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { saved = []; }
    if (!Array.isArray(saved)) return;
    saved.forEach(function (t) {
      if (!t || (t.role !== 'user' && t.role !== 'assistant') || typeof t.text !== 'string') return;
      turns.push({ role: t.role, text: t.text });
      bubble(t.role, t.text);
    });
    if (turns.length) dropChips();
  }

  function setBusy(on) { busy = on; send.disabled = on; }

  function ask(q) {
    q = q.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!q || busy) return;
    dropChips();
    bubble('user', q);
    turns.push({ role: 'user', text: q });
    save();
    setBusy(true);
    typing(true);
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 30000);
    fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: turns.slice(-8) }),
      signal: ctl.signal,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      typing(false);
      if (r.ok && r.data && typeof r.data.text === 'string' && r.data.text) {
        bubble('assistant', r.data.text);
        turns.push({ role: 'assistant', text: r.data.text });
      } else {
        fail(q, r.data && r.data.error);
      }
    }).catch(function () {
      typing(false);
      fail(q);
    }).then(function () {
      clearTimeout(timer);
      save();
      setBusy(false);
      if (!panel.hidden && !phone.matches) input.focus();
    });
  }

  // The question wasn't answered: say so, take it out of the history, and put it back in the box to send again.
  function fail(q, msg) {
    bubble('assistant', (msg || "I couldn't answer just now. Check your connection and try again, or message the team on WhatsApp +91 62077 74673 (https://wa.me/916207774673).").toString().slice(0, 400), 'fa-err');
    if (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
    if (!input.value) { input.value = q; grow(); }
  }

  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 112) + 'px';
  }

  // On a phone the chat is a full-screen sheet; the on-screen keyboard shrinks the visual viewport, not the layout one.
  function fit() {
    var vv = window.visualViewport;
    if (vv && phone.matches && !panel.hidden) panel.style.setProperty('--fa-h', vv.height + 'px'); else panel.style.removeProperty('--fa-h');
  }

  function open() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    panel.setAttribute('aria-modal', phone.matches ? 'true' : 'false');
    document.body.classList.toggle('fa-open', phone.matches);
    fit();
    toEnd();
    // A touch screen would pop the keyboard over the answer straight away, so there the panel itself gets the focus.
    (matchMedia('(pointer:coarse)').matches ? panel : input).focus({ preventScroll: true });
  }

  function shut(back) {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('fa-open');
    fit();
    if (back) launcher.focus({ preventScroll: true });
  }

  launcher.addEventListener('click', function () { if (panel.hidden) open(); else shut(true); });
  closeBtn.addEventListener('click', function () { shut(true); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value;
    if (!q.trim() || busy) return;
    input.value = '';
    grow();
    ask(q);
  });
  input.addEventListener('input', grow);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  log.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('.fa-chip');
    if (chip) ask(chip.dataset.q || chip.textContent);
  });
  root.addEventListener('keydown', function (e) {
    if (panel.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); shut(true); return; }
    // As a full-screen sheet it behaves as a modal: Tab stays inside it.
    if (e.key === 'Tab' && phone.matches) {
      var f = [].slice.call(panel.querySelectorAll('button:not([disabled]), a[href], textarea, [tabindex="0"]'));
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  if (window.visualViewport) { visualViewport.addEventListener('resize', fit); visualViewport.addEventListener('scroll', fit); }
  phone.addEventListener('change', function () { document.body.classList.toggle('fa-open', phone.matches && !panel.hidden); fit(); });

  restore();
  root.hidden = false;
})();
