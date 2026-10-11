import { join } from "node:path";
import type { SessionStatus } from "../generated/prisma/index.js";
import { AppError } from "../utils/errors.js";
import type { Logger } from "../utils/logger.js";
import type { EventBus } from "./events.js";
import type { OutgoingMedia, ProviderClient, WhatsAppProvider } from "./provider.js";
import type { QRManager } from "./QRManager.js";
import type { SessionStore } from "./SessionStore.js";

export type SessionOptions = {
  authRoot: string;
  /** Give up on a QR nobody is looking at after this long. */
  qrIdleMs: number;
  /** Stop reconnecting after this long offline. */
  giveUpMs: number;
  /** Is a Fitron screen watching this gym's events stream right now? */
  isWatched: (gymId: string) => Promise<boolean>;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
};

export type SessionHooks = {
  onIncomingText: (gymId: string, from: string, text: string) => Promise<void>;
  onReceipt: (gymId: string, providerMessageId: string, status: "DELIVERED" | "READ" | "FAILED") => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One gym's WhatsApp connection and its state machine:
 *   QR_REQUIRED -> CONNECTING -> CONNECTED -> (RECONNECTING -> CONNECTED | DISCONNECTED | SESSION_EXPIRED)
 * Only this class touches the provider client; the manager owns the map of sessions.
 */
export class WhatsAppSession {
  status: SessionStatus = "DISCONNECTED";
  phone: string | null = null;
  lastError: string | null = null;

  private client: ProviderClient | null = null;
  private starting: Promise<void> | null = null;
  private stopping = false;
  private closed = false;
  private wasConnected = false;
  private offlineSince: number | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private qrIdleTimer: NodeJS.Timeout | null = null;
  private lastQrAt = 0;
  readonly log: Logger;

  constructor(
    readonly gymId: string,
    private readonly provider: WhatsAppProvider,
    private readonly store: SessionStore,
    private readonly bus: EventBus,
    private readonly qr: QRManager,
    private readonly hooks: SessionHooks,
    private readonly opts: SessionOptions,
    logger: Logger,
  ) {
    this.log = logger.child({ gymId });
  }

  get authDir(): string {
    return join(this.opts.authRoot, this.gymId);
  }

  get connected(): boolean {
    return this.status === "CONNECTED" && this.client !== null;
  }

  /** Opens the socket. Resolves once the client exists (not once connected). Safe to call repeatedly. */
  async start(): Promise<void> {
    if (this.closed) throw new AppError("CONFLICT", "Session is closed.");
    if (this.client) return;
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => (this.starting = null));
    return this.starting;
  }

  private async doStart(): Promise<void> {
    this.stopping = false;
    const saved = await this.provider.hasSavedLogin(this.authDir);
    await this.setStatus(saved ? (this.wasConnected ? "RECONNECTING" : "CONNECTING") : "QR_REQUIRED", { sessionLocation: this.gymId, lastError: null });
    try {
      this.client = await this.provider.createClient({
        gymId: this.gymId,
        authDir: this.authDir,
        logger: this.log,
        handlers: {
          onQr: (qr) => void this.handleQr(qr),
          onOpen: (info) => void this.handleOpen(info.phone),
          onClose: (info) => void this.handleClose(info),
          onIncomingText: (m) => void this.hooks.onIncomingText(this.gymId, m.from, m.text).catch((err: Error) => this.log.warn({ err: err.message }, "incoming message hook failed")),
          onReceipt: (r) => void this.hooks.onReceipt(this.gymId, r.providerMessageId, r.status).catch((err: Error) => this.log.warn({ err: err.message }, "receipt hook failed")),
        },
      });
    } catch (err) {
      const message = (err as Error).message;
      this.log.error({ err: message }, "could not create WhatsApp client");
      await this.setStatus("DISCONNECTED", { lastError: message });
      throw err;
    }
  }

  private async handleQr(raw: string): Promise<void> {
    if (this.stopping || this.closed) return;
    this.lastQrAt = Date.now();
    if (this.status !== "QR_REQUIRED") await this.setStatus("QR_REQUIRED", { phoneNumber: null });
    try {
      const dataUrl = await this.qr.render(raw);
      const { expiresAt } = await this.qr.store(this.gymId, dataUrl);
      await this.bus.publish(this.gymId, { type: "qr", data: dataUrl, expiresAt });
    } catch (err) {
      this.log.error({ err: (err as Error).message }, "could not publish QR");
    }
    this.armQrIdleTimer();
  }

  /** Nobody scanning and nobody watching: close the socket instead of asking WhatsApp for QR codes forever. */
  private armQrIdleTimer(): void {
    if (this.qrIdleTimer) clearTimeout(this.qrIdleTimer);
    this.qrIdleTimer = setTimeout(async () => {
      this.qrIdleTimer = null;
      if (this.status !== "QR_REQUIRED" || this.closed) return;
      if (await this.opts.isWatched(this.gymId)) return this.armQrIdleTimer();
      this.log.info("QR not scanned and nobody watching; closing");
      await this.stop("QR code expired: nobody scanned it. Press Connect again.");
    }, this.opts.qrIdleMs);
    this.qrIdleTimer.unref?.();
  }

  private async handleOpen(phone: string | null): Promise<void> {
    if (this.stopping || this.closed) return;
    this.wasConnected = true;
    this.offlineSince = null;
    this.reconnectAttempt = 0;
    this.phone = phone;
    if (this.qrIdleTimer) {
      clearTimeout(this.qrIdleTimer);
      this.qrIdleTimer = null;
    }
    await this.qr.clear(this.gymId);
    await this.setStatus("CONNECTED", { phoneNumber: phone, lastError: null });
    this.log.info("WhatsApp connected");
  }

  private async handleClose(info: { reason: string; statusCode: number | undefined; message: string }): Promise<void> {
    this.client = null;
    if (this.closed) return;
    if (this.stopping) return; // stop()/logout() already set the final status
    this.log.warn({ reason: info.reason, statusCode: info.statusCode }, "WhatsApp connection closed");

    if (info.reason === "loggedOut" || info.reason === "badSession") {
      await this.provider.clearAuth(this.authDir).catch(() => undefined);
      await this.qr.clear(this.gymId);
      this.phone = null;
      await this.setStatus(this.wasConnected ? "SESSION_EXPIRED" : "AUTH_FAILURE", { phoneNumber: null, lastError: this.wasConnected ? "WhatsApp signed this device out. Connect again and scan a new QR code." : `WhatsApp rejected the login (${info.message}). Connect again and scan a new QR code.` });
      this.wasConnected = false;
      return;
    }
    if (info.reason === "replaced") {
      await this.setStatus("DISCONNECTED", { lastError: "Another connection took over this WhatsApp session." });
      return;
    }
    // During pairing, Baileys closes the socket when the QR codes run out. Keep going only while someone is watching.
    if (this.status === "QR_REQUIRED") {
      if (await this.opts.isWatched(this.gymId)) return this.scheduleReconnect(this.opts.backoffBaseMs ?? 500);
      await this.qr.clear(this.gymId);
      await this.setStatus("DISCONNECTED", { lastError: "QR code expired: nobody scanned it. Press Connect again." });
      return;
    }
    if (info.reason === "restartRequired") return this.scheduleReconnect(250);

    this.offlineSince ??= Date.now();
    if (Date.now() - this.offlineSince > this.opts.giveUpMs) {
      await this.setStatus("DISCONNECTED", { lastError: `Could not reconnect to WhatsApp for ${Math.round(this.opts.giveUpMs / 60000)} minutes (${info.message}). Press Connect to try again.` });
      return;
    }
    const base = this.opts.backoffBaseMs ?? 2000;
    const max = this.opts.backoffMaxMs ?? 60_000;
    const delay = Math.min(max, base * 2 ** Math.min(this.reconnectAttempt, 10)) + Math.floor(Math.random() * 500);
    this.reconnectAttempt++;
    await this.setStatus("RECONNECTING", { lastError: info.message });
    this.scheduleReconnect(delay);
  }

  private scheduleReconnect(delay: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed || this.stopping || this.client) return;
      this.start().catch((err: Error) => {
        this.log.error({ err: err.message }, "reconnect failed");
        this.scheduleReconnect(Math.min(this.opts.backoffMaxMs ?? 60_000, (this.opts.backoffBaseMs ?? 2000) * 2 ** Math.min(++this.reconnectAttempt, 10)));
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /** Close the socket but keep the saved login, so the next start() reconnects without a QR. */
  async stop(reason = "Disconnected by request."): Promise<void> {
    this.stopping = true;
    this.clearTimers();
    const c = this.client;
    this.client = null;
    if (c) await c.close().catch(() => undefined);
    await this.qr.clear(this.gymId);
    await this.setStatus("DISCONNECTED", { lastError: reason });
  }

  /** Sign out of WhatsApp and delete the saved login. The phone drops this linked device. */
  async logout(): Promise<void> {
    this.stopping = true;
    this.clearTimers();
    const c = this.client;
    this.client = null;
    if (c) {
      await c.logout().catch((err: Error) => this.log.warn({ err: err.message }, "logout call failed; clearing local credentials anyway"));
    }
    await this.provider.clearAuth(this.authDir).catch(() => undefined);
    await this.qr.clear(this.gymId);
    this.phone = null;
    this.wasConnected = false;
    await this.setStatus("DISCONNECTED", { phoneNumber: null, lastError: null, sessionLocation: null, connectedAt: null });
  }

  /** stop() and never start again (process shutdown). The status stays as it was so the next boot restores it. */
  async close(): Promise<void> {
    this.closed = true;
    this.clearTimers();
    const c = this.client;
    this.client = null;
    if (c) await c.close().catch(() => undefined);
  }

  async sendText(digits: string, text: string): Promise<{ providerMessageId: string | null }> {
    const jid = await this.resolve(digits);
    return this.requireClient().sendText(jid, text);
  }

  async sendMedia(digits: string, media: OutgoingMedia): Promise<{ providerMessageId: string | null }> {
    const jid = await this.resolve(digits);
    return this.requireClient().sendMedia(jid, media);
  }

  private async resolve(digits: string): Promise<string> {
    const jid = await this.requireClient().resolveRecipient(digits);
    if (!jid) throw new AppError("NUMBER_NOT_ON_WHATSAPP", `+${digits} is not on WhatsApp.`);
    return jid;
  }

  private requireClient(): ProviderClient {
    if (!this.client || this.status !== "CONNECTED") throw new AppError("WHATSAPP_NOT_CONNECTED", "WhatsApp is not connected.");
    return this.client;
  }

  private async setStatus(status: SessionStatus, patch: { phoneNumber?: string | null; lastError?: string | null; sessionLocation?: string | null; connectedAt?: Date | null } = {}): Promise<void> {
    this.status = status;
    if (patch.phoneNumber !== undefined) this.phone = patch.phoneNumber;
    if (patch.lastError !== undefined) this.lastError = patch.lastError;
    try {
      await this.store.setStatus(this.gymId, status, patch);
    } catch (err) {
      this.log.error({ err: (err as Error).message }, "could not persist session status");
    }
    await this.bus.publish(this.gymId, { type: "status", data: { status, phone: this.phone, error: this.lastError } }).catch(() => undefined);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.qrIdleTimer) {
      clearTimeout(this.qrIdleTimer);
      this.qrIdleTimer = null;
    }
  }

  /** For tests: wait until the status matches. */
  async waitFor(pred: (s: SessionStatus) => boolean, timeoutMs = 5000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!pred(this.status)) {
      if (Date.now() > until) throw new Error(`timed out waiting for status (now ${this.status})`);
      await sleep(20);
    }
  }
}
