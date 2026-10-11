import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CreateClientOptions, OutgoingMedia, ProviderClient, ProviderHandlers, WhatsAppProvider } from "../../src/whatsapp/provider.js";

// A WhatsApp stand-in: the test drives it (emit a QR, "scan" it, drop the connection, deliver a reply) and inspects what
// was sent. Saved logins are a marker file, so restart-without-QR behaviour is real.

export type SentRecord = { gymId: string; jid: string; text?: string; media?: OutgoingMedia; providerMessageId: string };

export class MockClient implements ProviderClient {
  closed = false;
  loggedOut = false;
  constructor(
    readonly gymId: string,
    readonly authDir: string,
    readonly handlers: ProviderHandlers,
    private readonly provider: MockProvider,
  ) {}
  async sendText(jid: string, text: string) {
    if (this.closed) throw new Error("socket closed");
    if (this.provider.sendError) throw this.provider.sendError;
    const providerMessageId = `wamid.${this.provider.sent.length + 1}`;
    this.provider.sent.push({ gymId: this.gymId, jid, text, providerMessageId });
    return { providerMessageId };
  }
  async sendMedia(jid: string, media: OutgoingMedia) {
    if (this.closed) throw new Error("socket closed");
    const providerMessageId = `wamid.${this.provider.sent.length + 1}`;
    this.provider.sent.push({ gymId: this.gymId, jid, media, providerMessageId });
    return { providerMessageId };
  }
  async resolveRecipient(digits: string) {
    return this.provider.notOnWhatsApp.has(digits) ? null : `${digits}@s.whatsapp.net`;
  }
  async logout() {
    this.loggedOut = true;
    this.closed = true;
    await rm(this.authDir, { recursive: true, force: true });
  }
  async close() {
    this.closed = true;
  }
  // --- test controls ---
  emitQr(qr = `qr-${Date.now()}`) {
    this.handlers.onQr(qr);
  }
  async scan(phone = "919999900000") {
    await mkdir(this.authDir, { recursive: true });
    await writeFile(join(this.authDir, "creds.json"), JSON.stringify({ registered: true, me: { id: `${phone}:1@s.whatsapp.net` } }));
    this.handlers.onOpen({ phone });
  }
  open(phone = "919999900000") {
    this.handlers.onOpen({ phone });
  }
  drop(reason: "other" | "loggedOut" | "replaced" | "restartRequired" | "timedOut" | "badSession" = "other", statusCode?: number) {
    this.closed = true;
    this.handlers.onClose({ reason, statusCode, message: `closed: ${reason}` });
  }
  incoming(from: string, text: string) {
    this.handlers.onIncomingText({ from, text });
  }
  receipt(providerMessageId: string, status: "DELIVERED" | "READ" | "FAILED") {
    this.handlers.onReceipt({ providerMessageId, status });
  }
}

export class MockProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly clients: MockClient[] = [];
  readonly sent: SentRecord[] = [];
  readonly notOnWhatsApp = new Set<string>();
  sendError: Error | null = null;
  createError: Error | null = null;
  /** Called right after a client is created: e.g. auto-open when a saved login exists (like the real library). */
  autoOpenSaved = true;

  async createClient(opts: CreateClientOptions): Promise<ProviderClient> {
    if (this.createError) throw this.createError;
    const c = new MockClient(opts.gymId, opts.authDir, opts.handlers, this);
    this.clients.push(c);
    if (this.autoOpenSaved && (await this.hasSavedLogin(opts.authDir))) {
      const creds = JSON.parse(await readFile(join(opts.authDir, "creds.json"), "utf8")) as { me?: { id?: string } };
      const phone = creds.me?.id?.split(":")[0] ?? "919999900000";
      setImmediate(() => c.open(phone));
    }
    return c;
  }
  async hasSavedLogin(authDir: string): Promise<boolean> {
    return !!(await stat(join(authDir, "creds.json")).catch(() => null));
  }
  async clearAuth(authDir: string): Promise<void> {
    await rm(authDir, { recursive: true, force: true });
  }
  latest(gymId: string): MockClient {
    const c = [...this.clients].reverse().find((x) => x.gymId === gymId);
    if (!c) throw new Error(`no client for ${gymId}`);
    return c;
  }
}
