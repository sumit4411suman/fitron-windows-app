import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// WhatsApp built into FITRON for Windows (embedded.ts), with a stand-in for Baileys: a socket that shows a QR code, opens
// when the test says the phone scanned it, and records what was sent. Nothing here talks to WhatsApp.

type Sock = {
  ev: EventEmitter;
  user?: { id: string };
  creds: Record<string, unknown>;
  sent: { jid: string; content: Record<string, unknown> }[];
  onWhatsApp: (n: string) => Promise<{ exists: boolean; jid: string }[]>;
  sendMessage: (jid: string, content: Record<string, unknown>) => Promise<{ key: { id: string } }>;
  logout: () => Promise<void>;
  end: () => void;
};
const socks: Sock[] = [];
let onWhatsApp: (n: string) => boolean = () => true;
let serial = 0;

vi.mock("qrcode", () => ({ default: { toDataURL: async (t: string) => `data:image/png;base64,${Buffer.from(t).toString("base64")}` } }));
vi.mock("baileys", () => ({
  BufferJSON: { replacer: (_k: string, v: unknown) => v, reviver: (_k: string, v: unknown) => v },
  initAuthCreds: () => ({ registered: false }),
  proto: { Message: { AppStateSyncKeyData: { fromObject: (o: unknown) => o } } },
  makeCacheableSignalKeyStore: (k: unknown) => k,
  Browsers: { windows: (n: string) => [n, "Windows", "10"] },
  DisconnectReason: { loggedOut: 401, forbidden: 403, restartRequired: 515, timedOut: 408 },
  jidNormalizedUser: (j?: string) => (j ? j.replace(/:\d+@/, "@") : ""),
  makeWASocket: (cfg: { auth: { creds: Record<string, unknown> } }) => {
    const s: Sock = {
      ev: new EventEmitter(),
      creds: cfg.auth.creds,
      sent: [],
      onWhatsApp: async (n) => (onWhatsApp(n) ? [{ exists: true, jid: `${n}@s.whatsapp.net` }] : []),
      sendMessage: async (jid, content) => {
        s.sent.push({ jid, content });
        return { key: { id: `wamid-${++serial}` } };
      },
      logout: async () => {},
      end: () => {},
    };
    socks.push(s);
    return s;
  },
}));

const root = mkdtempSync(path.join(os.tmpdir(), "fitron-wa-"));
type Embedded = typeof import("./embedded");
let wa: Embedded;
const last = () => socks[socks.length - 1]!;
const until = async (ok: () => boolean | Promise<boolean>, ms = 8_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};
/** The phone scans the QR code: WhatsApp gives the link its account, then the connection opens. */
const scan = async (phone = "919876500000") => {
  const s = last();
  Object.assign(s.creds, { me: { id: `${phone}:7@s.whatsapp.net` } });
  s.ev.emit("creds.update", { me: s.creds.me });
  s.user = { id: `${phone}:7@s.whatsapp.net` };
  s.ev.emit("connection.update", { connection: "open" });
  await until(() => existsSync(path.join(wa.whatsappDir("org_a", root), "session", "creds.json")));
};

beforeAll(async () => {
  vi.stubEnv("FITRON_DATA_DIR", root);
  vi.stubEnv("BIOMETRIC_KEY", "a-sealed-secret-for-these-tests-0001");
  wa = await import("./embedded");
});
beforeEach(() => {
  onWhatsApp = () => true;
});
afterEach(async () => {
  await wa.stopEmbeddedWhatsApp(0);
  (globalThis as { fitronWhatsApp?: Map<string, unknown> }).fitronWhatsApp?.clear();
  rmSync(path.join(root, "whatsapp"), { recursive: true, force: true });
  socks.length = 0;
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("WhatsApp built into FITRON for Windows", () => {
  it("encrypts the link's files: unreadable without this installation's key, and refused when altered", () => {
    const key = Buffer.alloc(32, 7);
    const blob = wa.encrypt('{"me":"919876500000"}', key);
    expect(blob.toString("utf8")).not.toContain("919876500000");
    expect(wa.decrypt(blob, key)).toBe('{"me":"919876500000"}');
    expect(() => wa.decrypt(blob, Buffer.alloc(32, 8))).toThrow();
    const altered = Buffer.from(blob);
    altered[altered.length - 1]! ^= 1;
    expect(() => wa.decrypt(altered, key)).toThrow();
  });

  it("keeps nothing to send while no phone is linked here, and says what to do", async () => {
    expect(wa.hasLink("org_a")).toBe(false);
    expect(wa.embeddedSend("org_a", { localId: "m1", to: "919800000001", body: "Hi" })).toEqual({ status: "Failed", error: wa.NOT_LINKED_HERE });
    expect(await wa.embeddedStatus("org_a")).toMatchObject({ state: "disconnected", queued: 0 });
    expect(socks).toHaveLength(0);
  });

  it("links by QR code, keeps the link encrypted, and reconnects by itself at the next start", async () => {
    const st = await wa.embeddedStatus("org_a", { start: true });
    expect(st.state).toBe("starting");
    last().ev.emit("connection.update", { qr: "2@scan-me" });
    await until(async () => (await wa.embeddedStatus("org_a")).state === "qr" && !!(await wa.embeddedStatus("org_a")).qr);
    expect((await wa.embeddedStatus("org_a")).qr).toMatch(/^data:image\/png;base64,/);
    await scan();
    expect(await wa.embeddedStatus("org_a")).toMatchObject({ state: "ready", number: "919876500000", cap: wa.DAILY_CAP });
    expect(wa.hasLink("org_a")).toBe(true);
    const sessionDir = path.join(wa.whatsappDir("org_a", root), "session");
    for (const f of readdirSync(sessionDir)) expect(readFileSync(path.join(sessionDir, f)).toString("utf8")).not.toContain("919876500000");
    // FITRON closes and opens again: the link comes back without a QR code.
    await wa.stopEmbeddedWhatsApp(0);
    (globalThis as { fitronWhatsApp?: Map<string, unknown> }).fitronWhatsApp?.clear();
    const before = socks.length;
    wa.resumeEmbeddedWhatsApp(root);
    await until(() => socks.length === before + 1);
  });

  it("sends at a gentle pace, by FITRON's own id, and follows delivery and reading", async () => {
    await wa.embeddedStatus("org_a", { start: true });
    await scan();
    expect(wa.embeddedSend("org_a", { localId: "m1", to: "919800000001", body: "Your plan ends on 5 Oct" })).toEqual({ status: "Queued", providerMessageId: "m1" });
    wa.embeddedSend("org_a", { localId: "m2", to: "919800000002", body: "Invoice", pdf: { bytes: new Uint8Array([37, 80, 68, 70]), filename: "INV-1.pdf" } });
    expect(wa.embeddedResults("org_a", ["m1", "m2", "m9"])).toMatchObject({ m2: { status: "Queued" } });
    await until(() => last().sent.length === 2);
    expect(last().sent[0]).toEqual({ jid: "919800000001@s.whatsapp.net", content: { text: "Your plan ends on 5 Oct" } });
    expect(last().sent[1]!.content).toMatchObject({ mimetype: "application/pdf", fileName: "INV-1.pdf", caption: "Invoice" });
    await until(() => wa.embeddedResults("org_a", ["m2"]).m2?.status === "Sent");
    last().ev.emit("messages.update", [{ key: { fromMe: true, id: "wamid-1" }, update: { status: 3 } }]);
    last().ev.emit("messages.update", [{ key: { fromMe: true, id: "wamid-2" }, update: { status: 4 } }]);
    expect(wa.embeddedResults("org_a", ["m1", "m2", "m9"])).toEqual({ m1: { status: "Delivered" }, m2: { status: "Read" } });
    expect((await wa.embeddedStatus("org_a")).sentToday).toBe(2);
    expect(readdirSync(path.join(wa.whatsappDir("org_a", root), "outbox"))).toEqual([]);
  }, 15_000);

  it("does not message a member who replied STOP until they reply START, nor a number not on WhatsApp", async () => {
    await wa.embeddedStatus("org_a", { start: true });
    await scan();
    last().ev.emit("messages.upsert", { type: "notify", messages: [{ key: { fromMe: false, remoteJid: "919800000003@s.whatsapp.net" }, message: { conversation: " stop " } }] });
    onWhatsApp = (n) => n !== "919800000004";
    wa.embeddedSend("org_a", { localId: "s1", to: "919800000003", body: "Offer" });
    wa.embeddedSend("org_a", { localId: "s2", to: "919800000004", body: "Offer" });
    await until(() => Object.keys(wa.embeddedResults("org_a", ["s1", "s2"])).length === 2 && wa.embeddedResults("org_a", ["s2"]).s2?.status !== "Queued");
    expect(wa.embeddedResults("org_a", ["s1", "s2"])).toEqual({ s1: { status: "Failed", error: expect.stringMatching(/replied STOP/) }, s2: { status: "Failed", error: "This number is not on WhatsApp." } });
    expect(last().sent).toEqual([]);
    last().ev.emit("messages.upsert", { type: "notify", messages: [{ key: { fromMe: false, remoteJid: "919800000003@s.whatsapp.net" }, message: { conversation: "START" } }] });
    wa.embeddedSend("org_a", { localId: "s3", to: "919800000003", body: "Welcome back" });
    await until(() => last().sent.length === 1);
  }, 15_000);

  it("keeps messages that wait while the link is down, and sends them once it is back", async () => {
    await wa.embeddedStatus("org_a", { start: true });
    await scan();
    last().ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 428 } } } });
    expect((await wa.embeddedStatus("org_a")).state).toBe("reconnecting");
    wa.embeddedSend("org_a", { localId: "w1", to: "919800000005", body: "Hi" });
    expect(wa.embeddedResults("org_a", ["w1"])).toEqual({ w1: { status: "Queued" } });
    expect((await wa.embeddedStatus("org_a")).queued).toBe(1);
    await until(() => socks.length === 2, 10_000);
    last().user = { id: "919876500000:7@s.whatsapp.net" };
    last().ev.emit("connection.update", { connection: "open" });
    await until(() => last().sent.length === 1);
    await until(() => wa.embeddedResults("org_a", ["w1"]).w1?.status === "Sent");
  }, 20_000);

  it("forgets the link when the phone unlinks FITRON, and on Unlink here", async () => {
    await wa.embeddedStatus("org_a", { start: true });
    await scan();
    last().ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
    expect(await wa.embeddedStatus("org_a")).toMatchObject({ state: "disconnected", error: expect.stringMatching(/unlinked on the phone/) });
    expect(wa.hasLink("org_a")).toBe(false);
    await wa.embeddedStatus("org_a", { start: true });
    await scan();
    expect(wa.hasLink("org_a")).toBe(true);
    await wa.embeddedLogout("org_a");
    expect(wa.hasLink("org_a")).toBe(false);
    expect(existsSync(path.join(wa.whatsappDir("org_a", root), "session"))).toBe(false);
    expect(await wa.embeddedStatus("org_a")).toMatchObject({ state: "disconnected" });
  });
});
