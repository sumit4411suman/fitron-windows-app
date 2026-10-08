// Fitron WhatsApp connector: every gym links its own WhatsApp by QR (like WhatsApp Web) and Fitron sends that gym's
// reminders, invoices and renewals from it. One connector serves many gyms: each gym has its own session, queue,
// daily cap and results, told apart by the x-fitron-org header the Fitron app sends. Members never link anything.
// Run on any always-on computer or server: `npm install` then `npm start`. Keep it running.
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const PORT = +process.env.PORT || 3131;
const KEY = process.env.FITRON_KEY || 'fitron-local';         // default works out of the box on the same PC; set your own when hosting
const HOST = process.env.HOST || (process.env.FITRON_KEY ? '0.0.0.0' : '127.0.0.1'); // default key = only this PC can reach it
const DAILY_CAP = +process.env.DAILY_CAP || 250;               // per gym
const GAP_MIN = 8000, GAP_MAX = 15000;                         // random gap between one gym's messages
const MAX_SESSIONS = +process.env.MAX_SESSIONS || 20;          // each linked gym keeps one Chrome open (about 300-500 MB)
const QR_IDLE_MS = 5 * 60000;                                  // a gym that opened the QR and left is closed after this
const SESSION_DIR = path.resolve(process.env.SESSION_DIR || './session'); // sessions survive restarts; delete a gym's folder to unlink it

// A gym's id as the Fitron app sends it. Only letters, digits, - and _ (it names a folder).
const orgOf = req => String(req.headers['x-fitron-org'] || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'default';
const dirOf = id => path.join(SESSION_DIR, 'session-' + id);

// Starting WhatsApp Web can fail (no internet, Chrome missing, a stale session). That must never stop the connector:
// keep the HTTP side up, say why in /status, and try again.
const friendly = e => {
  const m = String((e && e.message) || e);
  if (/Could not find (Chrome|Chromium|browser)|Failed to launch|executable/i.test(m)) return 'Chrome could not start. Run npm install again, or set CHROME_PATH to an installed Chrome or Chromium. (' + m.split('\n')[0] + ')';
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TUNNEL|ERR_PROXY|ERR_TIMED_OUT/i.test(m)) return 'This computer cannot reach web.whatsapp.com. Check its internet connection. Retrying every 15 seconds.';
  return m.split('\n')[0];
};

const sessions = new Map();

function makeSession(id) {
  const s = {
    id, state: 'starting', qr: null, me: null, error: null, sentToday: 0, day: new Date().toDateString(),
    queue: [], results: new Map(), busy: false, restarting: false, closed: false, seen: Date.now(), client: null,
  };
  s.client = new Client({
    authStrategy: new LocalAuth({ clientId: id, dataPath: SESSION_DIR }),
    puppeteer: { headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });
  const c = s.client;
  c.on('qr', async qr => { s.state = 'qr'; s.error = null; try { s.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 }); } catch (e) { console.error(id, 'QR failed', e.message); } });
  c.on('authenticated', () => { s.state = 'authenticating'; s.qr = null; s.error = null; });
  c.on('ready', () => { s.state = 'ready'; s.qr = null; s.error = null; s.me = c.info && c.info.wid ? c.info.wid.user : null; console.log('[' + id + '] WhatsApp linked:', s.me); pump(s); });
  c.on('auth_failure', m => { s.state = 'starting'; s.error = 'WhatsApp rejected the saved link: ' + m; console.error('[' + id + '] Auth failure', m); restart(s, 3000); });
  c.on('disconnected', r => { s.state = 'disconnected'; s.me = null; s.error = 'Disconnected: ' + r; console.warn('[' + id + '] Disconnected:', r); restart(s, 5000); });
  c.on('message_ack', (msg, ack) => {
    const r = s.results.get(msg.id._serialized);
    if (!r) return;
    const next = ack >= 3 ? 'Read' : ack >= 2 ? 'Delivered' : ack >= 1 ? 'Sent' : ack < 0 ? 'Failed' : null;
    if (next) { r.status = next; if (next === 'Failed') r.error = 'WhatsApp could not deliver this message'; }
  });
  return s;
}

async function start(s) {
  try { await s.client.initialize(); }
  catch (e) { if (s.closed) return; s.state = 'error'; s.qr = null; s.error = friendly(e); console.error('[' + s.id + '] Could not start WhatsApp:', s.error); restart(s, 15000); }
}
function restart(s, ms) {
  if (s.restarting || s.closed) return;
  s.restarting = true;
  setTimeout(async () => { try { await s.client.destroy(); } catch (e) {} s.restarting = false; if (s.closed) return; s.state = 'starting'; start(s); }, ms);
}
async function close(s, removeFiles) {
  s.closed = true;
  sessions.delete(s.id);
  try { await s.client.destroy(); } catch (e) {}
  if (removeFiles) try { fs.rmSync(dirOf(s.id), { recursive: true, force: true }); } catch (e) {}
}

// The session for a gym, started the first time it is asked for. A gym that never linked is not kept forever (see the sweep below).
function sessionFor(id) {
  let s = sessions.get(id);
  if (!s) {
    if (sessions.size >= MAX_SESSIONS) {
      const idle = [...sessions.values()].find(x => x.state !== 'ready' && x.state !== 'authenticating' && !x.queue.length && Date.now() - x.seen > 60000);   // make room by closing a gym that is not linked and has not been looking for a minute
      if (!idle) { const e = new Error('This connector is full (' + MAX_SESSIONS + ' gyms). Raise MAX_SESSIONS or run another connector.'); e.status = 503; throw e; }
      close(idle, false);
    }
    s = makeSession(id);
    sessions.set(id, s);
    start(s);
  }
  s.seen = Date.now();
  return s;
}

const toJid = n => { const d = String(n).replace(/\D/g, ''); return (d.length === 10 ? '91' + d : d) + '@c.us'; };
async function pump(s) {
  if (s.busy || s.closed || s.state !== 'ready' || !s.queue.length) return;
  if (new Date().toDateString() !== s.day) { s.day = new Date().toDateString(); s.sentToday = 0; }
  if (s.sentToday >= DAILY_CAP) return;
  s.busy = true;
  const job = s.queue.shift();
  try {
    const jid = toJid(job.to);
    const ok = await s.client.isRegisteredUser(jid);
    if (!ok) throw new Error('Number is not on WhatsApp');
    let msg;
    if (job.media && job.media.data) msg = await s.client.sendMessage(jid, new MessageMedia(job.media.mimetype || 'application/pdf', job.media.data, job.media.filename || 'invoice.pdf'), { caption: job.text });
    else msg = await s.client.sendMessage(jid, job.text);
    s.sentToday++;
    s.results.set(job.id, { status: 'Sent', waId: msg.id._serialized });
    s.results.set(msg.id._serialized, s.results.get(job.id));
  } catch (e) { s.results.set(job.id, { status: 'Failed', error: e.message }); }
  s.busy = false;
  setTimeout(() => pump(s), GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN));
}

process.on('unhandledRejection', e => { console.error('Unhandled:', (e && e.message) || e); });
process.on('uncaughtException', e => { console.error('Uncaught:', (e && e.message) || e); });

// Every minute: pick queues up again after a daily cap resets or a reconnect, and close gyms that opened the QR and never scanned it.
setInterval(() => {
  for (const s of [...sessions.values()]) {
    if (s.state === 'ready' || s.queue.length) pump(s);
    else if (s.state !== 'authenticating' && Date.now() - s.seen > QR_IDLE_MS) { console.log('[' + s.id + '] not linked and not watched, closing'); close(s, true); }
  }
}, 60000);

// After a restart, bring back every gym that is linked, so queued messages and delivery updates carry on.
try {
  for (const d of fs.readdirSync(SESSION_DIR)) {
    const m = /^session-([A-Za-z0-9_-]+)$/.exec(d);
    if (m && sessions.size < MAX_SESSIONS) sessionFor(m[1]);
  }
} catch (e) { /* first run: no session folder yet */ }

const app = express();
app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Private-Network', 'true'); next(); }); // Chrome Private Network Access
app.use(cors({ origin: true, allowedHeaders: ['Content-Type', 'x-fitron-key', 'x-fitron-org'] }));
app.options('*', (req, res) => res.sendStatus(204));
app.use(express.json({ limit: '15mb', verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));
app.post('/autopay/webhook', (req, res, next) => next()); // webhook is called by Razorpay without the Fitron key
app.use((req, res, next) => req.path === '/autopay/webhook' || req.headers['x-fitron-key'] === KEY ? next() : res.status(401).json({ error: 'Wrong connector key' }));
require('./autopay')(app); // UPI Autopay via Razorpay Subscriptions (set RZP_KEY_ID, RZP_KEY_SECRET, RZP_WEBHOOK_SECRET)

// Routes below act on the gym named in x-fitron-org.
const route = fn => (req, res) => { try { fn(req, res, sessionFor(orgOf(req))); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
app.get('/status', route((req, res, s) => res.json({ state: s.state, number: s.me, queued: s.queue.length, sentToday: s.sentToday, cap: DAILY_CAP, error: s.state === 'ready' ? null : s.error })));
app.get('/qr', route((req, res, s) => res.json({ state: s.state, qr: s.qr })));
app.post('/send', route((req, res, s) => {
  const { id, to, text, media } = req.body || {};
  if (!id || !to || !text) return res.status(400).json({ error: 'id, to and text are required' });
  s.queue.push({ id, to, text, media }); s.results.set(id, { status: 'Queued' }); pump(s);
  res.json({ id, status: 'Queued', position: s.queue.length });
}));
app.post('/results', route((req, res, s) => { const out = {}; ((req.body && req.body.ids) || []).forEach(i => { const r = s.results.get(i); if (r) out[i] = { status: r.status, error: r.error }; }); res.json(out); }));
app.post('/logout', route(async (req, res, s) => { try { await s.client.logout(); } catch (e) {} await close(s, true); res.json({ ok: true }); }));

const server = app.listen(PORT, HOST, () => console.log('Fitron WhatsApp connector running on ' + HOST + ':' + PORT + ' (up to ' + MAX_SESSIONS + ' gyms). Keep this window open.'));
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' is already in use: the connector is probably already running in another window. Close that one, or set PORT.' : 'Server error: ' + e.message); process.exit(1); });
