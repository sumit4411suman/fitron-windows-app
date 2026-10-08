// Fitron UPI Autopay via Razorpay Subscriptions (UPI Autopay / e-mandate).
// Mounted by server.js. Needs RZP_KEY_ID, RZP_KEY_SECRET and RZP_WEBHOOK_SECRET in the environment.
// Razorpay does the actual work: the member approves the mandate once in their UPI app, Razorpay sends the
// NPCI pre-debit notice 24 h before, charges on schedule, retries, and calls our webhook. Fitron only reacts.
const crypto = require('crypto');
const https = require('https');

const KEY = process.env.RZP_KEY_ID || '', SECRET = process.env.RZP_KEY_SECRET || '', WH = process.env.RZP_WEBHOOK_SECRET || '';
const events = [];            // in-memory event log the Fitron app polls (persist to a file/db in production)
const plans = new Map();      // amount|months -> razorpay plan id (avoid creating duplicate plans)

const rzp = (method, path, body) => new Promise((resolve, reject) => {
  if (!KEY || !SECRET) return reject(new Error('Razorpay keys are not set (RZP_KEY_ID / RZP_KEY_SECRET)'));
  const data = body ? JSON.stringify(body) : null;
  const req = https.request({ host: 'api.razorpay.com', path: '/v1' + path, method, auth: KEY + ':' + SECRET, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
    let out = ''; res.on('data', d => out += d); res.on('end', () => { let j = {}; try { j = JSON.parse(out || '{}'); } catch (e) {} if (res.statusCode >= 300) return reject(new Error((j.error && j.error.description) || ('Razorpay HTTP ' + res.statusCode))); resolve(j); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

const push = (type, payload) => { events.push({ n: events.length + 1, at: Date.now(), type, ...payload }); if (events.length > 5000) events.splice(0, events.length - 5000); };

module.exports = function mount(app) {
  app.get('/autopay/config', (req, res) => res.json({ ready: !!(KEY && SECRET), keyId: KEY, webhook: !!WH }));

  // 1. Create a mandate: plan (amount + interval) + subscription for the member. Returns the authorisation link.
  app.post('/autopay/mandate', async (req, res) => {
    try {
      const { mandateId, memberId, name, phone, email, amount, months, startAt, notes } = req.body || {};
      if (!mandateId || !amount || !months || !phone) return res.status(400).json({ error: 'mandateId, amount, months and phone are required' });
      const pk = amount + '|' + months; let planId = plans.get(pk);
      if (!planId) { const p = await rzp('POST', '/plans', { period: 'monthly', interval: +months, item: { name: 'Gym membership · ' + months + ' month' + (months > 1 ? 's' : ''), amount: Math.round(amount * 100), currency: 'INR' } }); planId = p.id; plans.set(pk, planId); }
      const sub = await rzp('POST', '/subscriptions', { plan_id: planId, total_count: 120, quantity: 1, customer_notify: 1, ...(startAt ? { start_at: Math.floor(new Date(startAt).getTime() / 1000) } : {}), notes: { fitron_mandate: mandateId, member: memberId || '', ...(notes || {}) } });
      push('mandate.created', { mandateId, subscriptionId: sub.id, status: sub.status });
      res.json({ subscriptionId: sub.id, shortUrl: sub.short_url, status: sub.status, keyId: KEY });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 2. Pause / resume / cancel go straight to Razorpay.
  app.post('/autopay/:sid/:action', async (req, res) => {
    const { sid, action } = req.params;
    try {
      let r;
      if (action === 'pause') r = await rzp('POST', '/subscriptions/' + sid + '/pause', { pause_at: 'now' });
      else if (action === 'resume') r = await rzp('POST', '/subscriptions/' + sid + '/resume', { resume_at: 'now' });
      else if (action === 'cancel') r = await rzp('POST', '/subscriptions/' + sid + '/cancel', { cancel_at_cycle_end: 0 });
      else if (action === 'fetch') r = await rzp('GET', '/subscriptions/' + sid);
      else return res.status(400).json({ error: 'Unknown action' });
      push('subscription.' + (action === 'fetch' ? 'synced' : action + 'd'), { subscriptionId: sid, status: r.status, chargeAt: r.charge_at ? r.charge_at * 1000 : null });
      res.json({ status: r.status, chargeAt: r.charge_at ? r.charge_at * 1000 : null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 3. Razorpay webhook. Configure https://<connector>/autopay/webhook in the Razorpay dashboard with events:
  //    subscription.authenticated, subscription.activated, subscription.charged, subscription.pending,
  //    subscription.halted, subscription.cancelled, subscription.paused, subscription.resumed, payment.failed
  app.post('/autopay/webhook', (req, res) => {
    const sig = req.headers['x-razorpay-signature'];
    if (WH) { const h = crypto.createHmac('sha256', WH).update(req.rawBody || JSON.stringify(req.body)).digest('hex'); if (h !== sig) return res.status(400).json({ error: 'Bad signature' }); }
    const ev = req.body || {}; const sub = (ev.payload && ev.payload.subscription && ev.payload.subscription.entity) || {}; const pay = (ev.payload && ev.payload.payment && ev.payload.payment.entity) || {};
    push(ev.event, { subscriptionId: sub.id || pay.subscription_id || null, mandateId: (sub.notes && sub.notes.fitron_mandate) || (pay.notes && pay.notes.fitron_mandate) || null, status: sub.status || null, chargeAt: sub.charge_at ? sub.charge_at * 1000 : null, paidCount: sub.paid_count || null, paymentId: pay.id || null, amount: pay.amount ? pay.amount / 100 : null, method: pay.method || null, vpa: pay.vpa || (pay.upi && pay.upi.vpa) || null, errorReason: pay.error_description || null });
    res.json({ ok: true });
  });

  // 4. The Fitron app polls new events and applies them to its own mandates.
  app.get('/autopay/events', (req, res) => { const since = +req.query.since || 0; res.json({ events: events.filter(e => e.n > since), last: events.length ? events[events.length - 1].n : since }); });
};
