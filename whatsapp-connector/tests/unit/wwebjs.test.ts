import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/utils/logger.js";
import type { ProviderHandlers } from "../../src/whatsapp/provider.js";
import { WwebjsProvider } from "../../src/whatsapp/WwebjsProvider.js";

// A stand-in for whatsapp-web.js: no Chromium, events are emitted by the test.
const clients: FakeClient[] = [];
class FakeClient extends EventEmitter {
  static failNextInit: Error | null = null;
  info = { wid: { user: "919999900000" } };
  destroyed = 0;
  loggedOut = false;
  sent: { to: string; content: unknown; opts?: Record<string, unknown> }[] = [];
  initialize = vi.fn(async () => undefined);
  constructor(readonly options: Record<string, unknown>) {
    super();
    clients.push(this);
    const fail = FakeClient.failNextInit;
    FakeClient.failNextInit = null;
    if (fail) this.initialize = vi.fn(async () => Promise.reject(fail));
  }
  async destroy() {
    this.destroyed++;
  }
  async logout() {
    this.loggedOut = true;
  }
  async sendMessage(to: string, content: unknown, opts?: Record<string, unknown>) {
    this.sent.push({ to, content, opts });
    return { id: { _serialized: `true_${to}_ABC${this.sent.length}` } };
  }
  async getNumberId(n: string) {
    return n === "910000000000" ? null : { _serialized: `${n}@c.us` };
  }
}
class FakeLocalAuth {
  constructor(readonly options: Record<string, unknown>) {}
}
class FakeMedia {
  constructor(
    readonly mimetype: string,
    readonly data: string,
    readonly filename?: string | null,
  ) {}
}
vi.mock("whatsapp-web.js", () => ({ default: { Client: FakeClient, LocalAuth: FakeLocalAuth, MessageMedia: FakeMedia } }));

const handlers = () => ({ onQr: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), onIncomingText: vi.fn(), onReceipt: vi.fn() }) satisfies ProviderHandlers;
const flush = () => new Promise((r) => setTimeout(r, 10));

describe("WwebjsProvider (whatsapp-web.js)", () => {
  let root: string;
  beforeEach(async () => {
    clients.length = 0;
    root = await mkdtemp(join(tmpdir(), "wwebjs-"));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("gives each gym its own Chromium profile and starts WhatsApp Web", async () => {
    const p = new WwebjsProvider({ executablePath: "/usr/bin/chromium-browser" });
    await p.createClient({ gymId: "gymA", authDir: join(root, "gymA"), handlers: handlers(), logger });
    await p.createClient({ gymId: "gymB", authDir: join(root, "gymB"), handlers: handlers(), logger });
    const [a, b] = clients;
    expect((a!.options.authStrategy as FakeLocalAuth).options.dataPath).toBe(join(root, "gymA"));
    expect((b!.options.authStrategy as FakeLocalAuth).options.dataPath).toBe(join(root, "gymB"));
    expect(a!.options.puppeteer).toMatchObject({ headless: true, executablePath: "/usr/bin/chromium-browser" });
    expect(a!.initialize).toHaveBeenCalledOnce();
    expect((await stat(join(root, "gymA"))).mode & 0o777).toBe(0o700);
  });

  it("passes QR codes on and reports the number once WhatsApp Web is ready", async () => {
    const h = handlers();
    await new WwebjsProvider().createClient({ gymId: "g", authDir: join(root, "g"), handlers: h, logger });
    clients[0]!.emit("qr", "2@xyz");
    expect(h.onQr).toHaveBeenCalledWith("2@xyz");
    clients[0]!.emit("ready");
    expect(h.onOpen).toHaveBeenCalledWith({ phone: "919999900000" });
  });

  it("a logout from the phone closes the browser and reports loggedOut, once", async () => {
    const h = handlers();
    await new WwebjsProvider().createClient({ gymId: "g", authDir: join(root, "g"), handlers: h, logger });
    clients[0]!.emit("disconnected", "LOGOUT");
    clients[0]!.emit("disconnected", "LOGOUT");
    await flush();
    expect(clients[0]!.destroyed).toBe(1);
    expect(h.onClose).toHaveBeenCalledOnce();
    expect(h.onClose.mock.calls[0]![0]).toMatchObject({ reason: "loggedOut" });
  });

  it("maps other disconnects and a rejected login", async () => {
    const cases: [string, string][] = [
      ["CONFLICT", "replaced"],
      ["TIMEOUT", "timedOut"],
      ["Max qrcode retries reached", "other"],
    ];
    for (const [reason, expected] of cases) {
      const h = handlers();
      await new WwebjsProvider().createClient({ gymId: "g", authDir: join(root, "g"), handlers: h, logger });
      clients.at(-1)!.emit("disconnected", reason);
      await flush();
      expect(h.onClose.mock.calls[0]![0]).toMatchObject({ reason: expected });
    }
    const h = handlers();
    await new WwebjsProvider().createClient({ gymId: "g", authDir: join(root, "g"), handlers: h, logger });
    clients.at(-1)!.emit("auth_failure", "bad");
    await flush();
    expect(h.onClose.mock.calls[0]![0]).toMatchObject({ reason: "badSession" });
  });

  it("a Chromium that cannot start is reported as a close, so the session retries", async () => {
    FakeClient.failNextInit = new Error("libnss3.so: cannot open shared object file");
    const h = handlers();
    await new WwebjsProvider().createClient({ gymId: "g", authDir: join(root, "g"), handlers: h, logger });
    await flush();
    expect(clients[0]!.destroyed).toBe(1);
    expect(h.onClose).toHaveBeenCalledOnce();
    expect(h.onClose.mock.calls[0]![0]).toMatchObject({ reason: "other", message: expect.stringContaining("libnss3.so") });
  });

  it("sends text, PDFs as documents, and resolves numbers", async () => {
    const client = await new WwebjsProvider().createClient({ gymId: "g", authDir: join(root, "g"), handlers: handlers(), logger });
    expect(await client.resolveRecipient("919876543210")).toBe("919876543210@c.us");
    expect(await client.resolveRecipient("910000000000")).toBeNull();
    const t = await client.sendText("919876543210@c.us", "Hello");
    expect(t.providerMessageId).toBe("true_919876543210@c.us_ABC1");
    await client.sendMedia("919876543210@c.us", { kind: "document", data: Buffer.from("%PDF-1.4"), mimeType: "application/pdf", fileName: "FITRON-INV-1042.pdf", caption: "Your invoice" });
    const doc = clients[0]!.sent[1]!;
    expect(doc.content).toBeInstanceOf(FakeMedia);
    expect(doc.content).toMatchObject({ mimetype: "application/pdf", filename: "FITRON-INV-1042.pdf", data: Buffer.from("%PDF-1.4").toString("base64") });
    expect(doc.opts).toEqual({ caption: "Your invoice", sendMediaAsDocument: true });
  });

  it("reports member replies from user chats only, and receipts for our own messages", async () => {
    const h = handlers();
    await new WwebjsProvider().createClient({ gymId: "g", authDir: join(root, "g"), handlers: h, logger });
    const c = clients[0]!;
    const msg = (from: string, extra: Record<string, unknown> = {}) => ({ from, body: "STOP", type: "chat", fromMe: false, getContact: async () => ({ number: "919811111111" }), ...extra });
    c.emit("message", msg("919876543210@c.us"));
    c.emit("message", msg("12036302@g.us"));
    c.emit("message", msg("status@broadcast"));
    c.emit("message", msg("1234567890@lid"));
    c.emit("message", msg("919876543210@c.us", { fromMe: true }));
    await flush();
    expect(h.onIncomingText.mock.calls.map((x) => x[0])).toEqual([
      { from: "919876543210", text: "STOP" },
      { from: "919811111111", text: "STOP" },
    ]);
    c.emit("message_ack", { fromMe: true, id: { _serialized: "m1" } }, 2);
    c.emit("message_ack", { fromMe: true, id: { _serialized: "m1" } }, 3);
    c.emit("message_ack", { fromMe: true, id: { _serialized: "m2" } }, -1);
    c.emit("message_ack", { fromMe: true, id: { _serialized: "m3" } }, 1);
    expect(h.onReceipt.mock.calls.map((x) => x[0])).toEqual([
      { providerMessageId: "m1", status: "DELIVERED" },
      { providerMessageId: "m1", status: "READ" },
      { providerMessageId: "m2", status: "FAILED" },
    ]);
  });

  it("logout signs out, closes the browser and deletes the gym's profile; saved login follows the folder", async () => {
    const p = new WwebjsProvider();
    const dir = join(root, "g");
    expect(await p.hasSavedLogin(dir)).toBe(false);
    const client = await p.createClient({ gymId: "g", authDir: dir, handlers: handlers(), logger });
    await mkdir(join(dir, "session"), { recursive: true });
    // Chromium makes its profile before anyone scans: not a login yet.
    expect(await p.hasSavedLogin(dir)).toBe(false);
    clients[0]!.emit("ready");
    await flush();
    expect(await p.hasSavedLogin(dir)).toBe(true);
    await client.logout();
    expect(clients[0]!.loggedOut).toBe(true);
    expect(clients[0]!.destroyed).toBe(1);
    expect(await p.hasSavedLogin(dir)).toBe(false);
    await expect(stat(dir)).rejects.toThrow();
  });

  it("close keeps the saved login", async () => {
    const p = new WwebjsProvider();
    const dir = join(root, "g");
    const client = await p.createClient({ gymId: "g", authDir: dir, handlers: handlers(), logger });
    await mkdir(join(dir, "session"), { recursive: true });
    clients[0]!.emit("ready");
    await flush();
    await client.close();
    expect(clients[0]!.destroyed).toBe(1);
    expect(await p.hasSavedLogin(dir)).toBe(true);
  });
});
