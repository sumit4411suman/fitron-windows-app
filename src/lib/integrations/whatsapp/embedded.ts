import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import type { AuthenticationCreds, SignalDataSet, SignalDataTypeMap, WASocket } from "baileys";
import { log } from "@/lib/log";
import { defaultDataRoot } from "@/lib/runtime/paths";
import { readLocalSecrets } from "@/lib/runtime/local-secrets";

// WhatsApp through the gym's own phone, run inside FITRON for Windows itself (no connector to install): the gym links
// its phone once by scanning a QR code in Settings › WhatsApp, and FITRON's server keeps that link while it is open,
// using Baileys (a WebSocket implementation of WhatsApp's multi-device protocol, the same library as the FITRON WhatsApp
// connector in whatsapp-connector/). Everything is kept in the data folder, under whatsapp/<gym>:
//   session/       the link's keys, each file encrypted (AES-256-GCM, key derived from this installation's sealed secret)
//   outbox/        messages waiting to go out: sent at a gentle pace while FITRON is open and online, kept across restarts
//   results.json   what became of each message (sent, delivered, read, failed), by FITRON's own message id
//   stopped.json   numbers that replied STOP: not messaged again until they reply START
// A gym can still use a connector on another computer instead (Settings › WhatsApp › Connector); then this is not used.

/** Seconds between two messages, and messages a day: a gentle pace, as a person sending them would. */
const PACE_MS = 2_500;
export const DAILY_CAP = 300;
const MAX_ATTEMPTS = 5;
const KEEP_RESULTS_MS = 30 * 86_400_000;

export type EmbeddedState = "ready" | "qr" | "starting" | "reconnecting" | "disconnected";
export type EmbeddedStatus = { state: EmbeddedState; number?: string; qr?: string; sentToday: number; cap: number; queued: number; error: string | null };
type Result = { status: "Sent" | "Delivered" | "Read" | "Failed"; error?: string; providerId?: string; at: string; sentAt?: string };
type OutboxItem = { localId: string; to: string; body: string; pdf?: { filename: string; base64: string }; at: string; attempts: number; lastError?: string };

type Session = {
  orgId: string;
  sock: WASocket | null;
  state: EmbeddedState;
  qr: string | null;
  phone: string | null;
  error: string | null;
  retries: number;
  sending: boolean;
  timer: NodeJS.Timeout | null;
  reconnect: NodeJS.Timeout | null;
  stopped: boolean;
};

const g = globalThis as unknown as { fitronWhatsApp?: Map<string, Session> };
const sessions = () => (g.fitronWhatsApp ??= new Map());

// ── Where things are, and the key ──

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
export const whatsappDir = (orgId: string, root = defaultDataRoot()) => path.join(root, "whatsapp", safe(orgId));
const dirs = (orgId: string) => {
  const base = whatsappDir(orgId);
  return { base, session: path.join(base, "session"), outbox: path.join(base, "outbox"), results: path.join(base, "results.json"), stopped: path.join(base, "stopped.json") };
};

/** The key the link's files are encrypted with: derived from this installation's sealed secret, never stored. */
function sessionKey(): Buffer {
  const secret = process.env.BIOMETRIC_KEY?.trim() || readLocalSecrets(defaultDataRoot()).BIOMETRIC_KEY || "";
  if (!secret) throw new Error("This installation has no secret to protect the WhatsApp link with yet. Restart FITRON.");
  return Buffer.from(hkdfSync("sha256", secret, "fitron-whatsapp", "session-files", 32));
}

const MAGIC = Buffer.from("WAC1");
export function encrypt(plain: string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), data]);
}
export function decrypt(blob: Buffer, key: Buffer): string {
  if (blob.length < 32 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error("Not an encrypted WhatsApp file");
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(4, 16));
  d.setAuthTag(blob.subarray(16, 32));
  return Buffer.concat([d.update(blob.subarray(32)), d.final()]).toString("utf8");
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, file);
}

// ── The link's keys, encrypted on disk (the same scheme as whatsapp-connector/src/whatsapp/authState.ts) ──

async function authState(folder: string, key: Buffer) {
  const { BufferJSON, initAuthCreds, proto } = await import("baileys");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const name = (f: string) => path.join(folder, f.replace(/\//g, "__").replace(/:/g, "-"));
  const locks = new Map<string, Promise<unknown>>();
  const serial = <T>(f: string, fn: () => Promise<T>): Promise<T> => {
    const next = (locks.get(f) ?? Promise.resolve()).then(fn, fn);
    locks.set(f, next.catch(() => undefined));
    return next;
  };
  const write = (data: unknown, f: string) => serial(f, () => writeFile(name(f), encrypt(JSON.stringify(data, BufferJSON.replacer), key), { mode: 0o600 }));
  const read = <T>(f: string) =>
    serial(f, async (): Promise<T | null> => {
      try {
        return JSON.parse(decrypt(await readFile(name(f)), key), BufferJSON.reviver) as T;
      } catch {
        return null;
      }
    });
  const remove = (f: string) => serial(f, () => unlink(name(f)).catch(() => undefined));
  const creds: AuthenticationCreds = (await read<AuthenticationCreds>("creds.json")) ?? initAuthCreds();
  return {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        await Promise.all(
          ids.map(async (id) => {
            let v = await read<SignalDataTypeMap[T]>(`${type}-${id}.json`);
            if (type === "app-state-sync-key" && v) v = proto.Message.AppStateSyncKeyData.fromObject(v as object) as unknown as SignalDataTypeMap[T];
            if (v) out[id] = v;
          }),
        );
        return out;
      },
      set: async (data: SignalDataSet) => {
        const tasks: Promise<unknown>[] = [];
        for (const cat of Object.keys(data) as (keyof SignalDataSet)[]) for (const [id, v] of Object.entries(data[cat] ?? {})) tasks.push(v ? write(v, `${cat}-${id}.json`) : remove(`${cat}-${id}.json`));
        await Promise.all(tasks);
      },
    },
    save: () => write(creds, "creds.json"),
  };
}

/**
 * Whether this gym's phone is linked on this computer: a saved login with the phone's account in it. (Baileys sets
 * `registered` only for a pairing code; a QR link is known by `me`.)
 */
export function hasLink(orgId: string): boolean {
  try {
    const creds = JSON.parse(decrypt(readFileSync(path.join(dirs(orgId).session, "creds.json")), sessionKey())) as Partial<AuthenticationCreds>;
    return !!creds.me?.id;
  } catch {
    return false;
  }
}

// Baileys wants a pino-like logger; its output can contain message text and keys, so nothing is written.
const silent = {
  level: "silent",
  child: () => silent,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

// ── Results, the outbox and STOP ──

function results(orgId: string): Record<string, Result> {
  return readJson<Record<string, Result>>(dirs(orgId).results, {});
}
function record(orgId: string, localId: string, r: Omit<Result, "at">) {
  const all = results(orgId);
  const now = Date.now();
  for (const [k, v] of Object.entries(all)) if (now - Date.parse(v.at) > KEEP_RESULTS_MS) delete all[k];
  all[localId] = { ...all[localId], ...r, at: new Date().toISOString() };
  writeJson(dirs(orgId).results, all);
}
/** The computer's own calendar day (YYYY-MM-DD). */
const localDay = (d: Date) => d.toLocaleDateString("en-CA");
const sentToday = (orgId: string) => {
  const day = localDay(new Date());
  return Object.values(results(orgId)).filter((r) => r.sentAt && localDay(new Date(r.sentAt)) === day).length;
};
const outboxFiles = (orgId: string) => {
  const d = dirs(orgId).outbox;
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).sort() : [];
};
const stoppedNumbers = (orgId: string) => new Set(readJson<string[]>(dirs(orgId).stopped, []));

/** A member replied STOP (or START) on WhatsApp: they are not messaged again until they reply START. */
export function noteReply(orgId: string, from: string, text: string) {
  const word = text.trim().toUpperCase();
  const set = stoppedNumbers(orgId);
  if (/^(STOP|UNSUBSCRIBE|STOP ALL)$/.test(word)) set.add(from);
  else if (/^(START|SUBSCRIBE)$/.test(word)) set.delete(from);
  else return;
  writeJson(dirs(orgId).stopped, [...set]);
}

// ── The link ──

function session(orgId: string): Session {
  let s = sessions().get(orgId);
  if (!s) {
    s = { orgId, sock: null, state: "disconnected", qr: null, phone: null, error: null, retries: 0, sending: false, timer: null, reconnect: null, stopped: false };
    sessions().set(orgId, s);
  }
  return s;
}

const digitsOf = (jid: string | null | undefined) => (jid ? jid.split("@")[0]!.split(":")[0]!.replace(/\D/g, "") : "");

async function connect(s: Session) {
  if (s.sock || s.stopped) return;
  s.state = s.retries ? "reconnecting" : "starting";
  const b = await import("baileys");
  const key = sessionKey();
  const auth = await authState(dirs(s.orgId).session, key);
  const sock = b.makeWASocket({
    auth: { creds: auth.creds, keys: b.makeCacheableSignalKeyStore(auth.keys, silent as never) },
    logger: silent as never,
    browser: b.Browsers.windows("FITRON"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 30_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000,
    qrTimeout: 60_000,
  });
  s.sock = sock;
  sock.ev.on("creds.update", () => void auth.save().catch((e) => log.error("whatsapp.embedded.save_failed", e)));
  sock.ev.on("connection.update", (u) => {
    if (u.qr) {
      s.state = "qr";
      void QRCode.toDataURL(u.qr, { margin: 1, width: 264 }).then((d) => (s.qr = d));
    }
    if (u.connection === "open") {
      s.state = "ready";
      s.qr = null;
      s.error = null;
      s.retries = 0;
      s.phone = digitsOf(b.jidNormalizedUser(sock.user?.id)) || null;
      log.info("whatsapp.embedded.open", { org: s.orgId });
      void pump(s);
    }
    if (u.connection === "close") {
      s.sock = null;
      s.qr = null;
      const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (s.stopped) return;
      if (code === b.DisconnectReason.loggedOut || code === b.DisconnectReason.forbidden) {
        rmSync(dirs(s.orgId).session, { recursive: true, force: true });
        s.state = "disconnected";
        s.phone = null;
        s.error = "WhatsApp was unlinked on the phone. Link it again in Settings › WhatsApp.";
        return;
      }
      if (!auth.creds.me?.id && code !== b.DisconnectReason.restartRequired) {
        // The QR code was not scanned in time: wait for Link WhatsApp to be pressed again.
        s.state = "disconnected";
        return;
      }
      s.retries++;
      s.state = "reconnecting";
      const wait = code === b.DisconnectReason.restartRequired ? 500 : Math.min(60_000, 2_000 * 2 ** Math.min(s.retries, 5));
      s.reconnect = setTimeout(() => void connect(s).catch((e) => fail(s, e)), wait);
      s.reconnect.unref?.();
    }
  });
  sock.ev.on("messages.update", (updates) => {
    const ids = idsBySent(s.orgId);
    for (const { key: k, update } of updates) {
      const localId = k.fromMe && k.id ? ids.get(k.id) : undefined;
      if (!localId) continue;
      const st = update.status;
      if (st === 3) record(s.orgId, localId, { status: "Delivered" });
      if (st === 4 || st === 5) record(s.orgId, localId, { status: "Read" });
    }
  });
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      if (m.key.fromMe) continue;
      const from = digitsOf(m.key.remoteJidAlt ?? m.key.remoteJid);
      const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? "";
      if (from && text) noteReply(s.orgId, from, text);
    }
  });
  if (!s.timer) {
    s.timer = setInterval(() => void pump(s), 60_000);
    s.timer.unref?.();
  }
}

function fail(s: Session, e: unknown) {
  s.sock = null;
  s.state = "disconnected";
  s.error = e instanceof Error ? e.message : String(e);
  log.error("whatsapp.embedded.failed", e);
}

function idsBySent(orgId: string) {
  const m = new Map<string, string>();
  for (const [localId, r] of Object.entries(results(orgId))) if (r.providerId) m.set(r.providerId, localId);
  return m;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends what is waiting, one at a time, while the phone is linked and the day's allowance lasts. */
async function pump(s: Session) {
  if (s.sending || s.state !== "ready" || !s.sock) return;
  s.sending = true;
  try {
    // The outbox is read again for each message, so one kept while another was going out is sent in the same round.
    for (let f = outboxFiles(s.orgId)[0]; f; f = outboxFiles(s.orgId)[0]) {
      if (s.stopped || s.state !== "ready" || !s.sock) break;
      if (sentToday(s.orgId) >= DAILY_CAP) break;
      const file = path.join(dirs(s.orgId).outbox, f);
      const item = readJson<OutboxItem | null>(file, null);
      if (!item) {
        rmSync(file, { force: true });
        continue;
      }
      if (stoppedNumbers(s.orgId).has(item.to)) {
        record(s.orgId, item.localId, { status: "Failed", error: "This member replied STOP on WhatsApp, so FITRON does not message them until they reply START." });
        rmSync(file, { force: true });
        continue;
      }
      try {
        const found = (await s.sock.onWhatsApp(item.to))?.find((r) => r.exists);
        if (!found) {
          record(s.orgId, item.localId, { status: "Failed", error: "This number is not on WhatsApp." });
          rmSync(file, { force: true });
          continue;
        }
        const jid = found.jid || `${item.to}@s.whatsapp.net`;
        const sent = item.pdf
          ? await s.sock.sendMessage(jid, { document: Buffer.from(item.pdf.base64, "base64"), mimetype: "application/pdf", fileName: item.pdf.filename, caption: item.body })
          : await s.sock.sendMessage(jid, { text: item.body });
        record(s.orgId, item.localId, { status: "Sent", providerId: sent?.key?.id ?? undefined, sentAt: new Date().toISOString() });
        rmSync(file, { force: true });
      } catch (e) {
        const attempts = item.attempts + 1;
        const why = e instanceof Error ? e.message : String(e);
        if (attempts >= MAX_ATTEMPTS) {
          record(s.orgId, item.localId, { status: "Failed", error: `WhatsApp did not take the message after ${attempts} tries (${why}).` });
          rmSync(file, { force: true });
        } else writeJson(file, { ...item, attempts, lastError: why });
        // Try again on the next round, not straight away.
        break;
      }
      await sleep(PACE_MS);
    }
  } finally {
    s.sending = false;
  }
}

// ── What the WhatsApp integration calls (src/lib/integrations/whatsapp/index.ts) ──

export const NOT_LINKED_HERE = "WhatsApp is not linked on this computer. Press Link WhatsApp in Settings › WhatsApp and scan the QR code with the gym phone.";

/**
 * Keeps a message to send through the linked phone; it goes out in turn. FITRON's own id is the message's key. With no
 * phone linked here nothing is kept (it would wait for ever): the message is Failed and says what to do.
 */
export function embeddedSend(orgId: string, m: { localId: string; to: string; body: string; pdf?: { bytes: Uint8Array; filename: string } }): { status: "Queued"; providerMessageId: string } | { status: "Failed"; error: string } {
  if (!hasLink(orgId)) return { status: "Failed", error: NOT_LINKED_HERE };
  const item: OutboxItem = { localId: m.localId, to: m.to, body: m.body, at: new Date().toISOString(), attempts: 0, ...(m.pdf ? { pdf: { filename: m.pdf.filename, base64: Buffer.from(m.pdf.bytes).toString("base64") } } : {}) };
  writeJson(path.join(dirs(orgId).outbox, `${Date.now().toString(36).padStart(10, "0")}-${safe(m.localId)}.json`), item);
  const s = session(orgId);
  if (s.state === "ready") void pump(s);
  else if (!s.sock) void connect(s).catch((e) => fail(s, e));
  return { status: "Queued", providerMessageId: m.localId };
}

/**
 * What became of messages, by FITRON's ids: { id: { status, error } }. A message still waiting in the outbox is Queued
 * (so it is not given up on while the computer was closed); one this computer never had is not listed.
 */
export function embeddedResults(orgId: string, ids: string[]): Record<string, { status: string; error?: string }> {
  const all = results(orgId);
  const want = new Set(ids);
  const out: Record<string, { status: string; error?: string }> = {};
  for (const f of outboxFiles(orgId)) {
    const item = readJson<OutboxItem | null>(path.join(dirs(orgId).outbox, f), null);
    if (item && want.has(item.localId)) out[item.localId] = { status: "Queued" };
  }
  for (const id of ids) if (all[id]) out[id] = { status: all[id].status, ...(all[id].error ? { error: all[id].error } : {}) };
  return out;
}

/** The link's state and, while it waits for a scan, the QR code. With `start`, linking starts (Link WhatsApp). */
export async function embeddedStatus(orgId: string, opts: { start?: boolean } = {}): Promise<EmbeddedStatus> {
  const s = session(orgId);
  if (!s.sock && s.state !== "reconnecting" && (opts.start || hasLink(orgId))) {
    s.stopped = false;
    s.error = null;
    await connect(s).catch((e) => fail(s, e));
  }
  return { state: s.state, ...(s.phone ? { number: s.phone } : {}), ...(s.state === "qr" && s.qr ? { qr: s.qr } : {}), sentToday: sentToday(orgId), cap: DAILY_CAP, queued: outboxFiles(orgId).length, error: s.error };
}

/** Unlink: the phone is logged out and the link's keys are deleted. Messages still waiting stay, unsent. */
export async function embeddedLogout(orgId: string) {
  const s = session(orgId);
  s.stopped = true;
  if (s.reconnect) clearTimeout(s.reconnect);
  try {
    await s.sock?.logout();
  } catch {
    // Already closed.
  }
  s.sock = null;
  s.state = "disconnected";
  s.phone = null;
  s.qr = null;
  rmSync(dirs(orgId).session, { recursive: true, force: true });
}

/** When FITRON starts: every gym whose phone is linked here reconnects, so what is waiting goes out. */
export function resumeEmbeddedWhatsApp(root = defaultDataRoot()) {
  const base = path.join(root, "whatsapp");
  if (!existsSync(base)) return;
  for (const org of readdirSync(base)) {
    if (!hasLink(org)) continue;
    void connect(session(org)).catch((e) => fail(session(org), e));
  }
}

/**
 * When FITRON closes: a message being sent is let finish (up to `waitMs`), so it is not sent again at the next start;
 * then the links are closed (not logged out: they reconnect at the next start).
 */
export async function stopEmbeddedWhatsApp(waitMs = 5_000) {
  const all = [...sessions().values()];
  for (const s of all) {
    s.stopped = true;
    if (s.timer) clearInterval(s.timer);
    if (s.reconnect) clearTimeout(s.reconnect);
    s.timer = null;
  }
  const until = Date.now() + waitMs;
  while (all.some((s) => s.sending) && Date.now() < until) await sleep(100);
  for (const s of all) {
    try {
      s.sock?.end(undefined);
    } catch {
      // Closing anyway.
    }
    s.sock = null;
  }
}
