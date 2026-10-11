import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/index.js";
import type { RedisClient } from "../config/redis.js";
import { ConsentService, matchesKeyword } from "../services/ConsentService.js";
import { MessageLogService } from "../services/MessageLogService.js";
import { REDIS_KEYS, type SessionCommand } from "../types/index.js";
import type { Logger } from "../utils/logger.js";
import type { EventBus } from "./events.js";
import type { OutgoingMedia, WhatsAppProvider } from "./provider.js";
import { QRManager } from "./QRManager.js";
import { SessionStore } from "./SessionStore.js";
import { WhatsAppSession, type SessionOptions } from "./WhatsAppSession.js";

export type ManagerOptions = SessionOptions & {
  optOutKeywords: string[];
  optInKeywords: string[];
  optOutReply: string;
  consentPolicy: { allowTransactionalAfterOptOut: boolean; requireOptInForTransactional: boolean };
  /** How long a QR_REQUIRED/CONNECTING row counts as a live connect request after a restart. */
  restoreWindowMs?: number;
};

export const WORKER_LOCK_TTL_MS = 30_000;
export const HEARTBEAT_TTL_SECONDS = 20;

/**
 * Owns every gym's WhatsAppSession in the one process that is allowed to hold WhatsApp sockets. Listens for commands
 * from the API over Redis, restores sessions after a restart, handles opt-out keywords and delivery receipts, and hands
 * the queue worker a way to send.
 */
export class WhatsAppManager {
  private readonly sessions = new Map<string, WhatsAppSession>();
  readonly store: SessionStore;
  readonly qr: QRManager;
  private readonly consent: ConsentService;
  private readonly messages: MessageLogService;
  private unsubscribe: (() => void) | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private lockTimer: NodeJS.Timeout | null = null;
  readonly instanceId = randomUUID();
  private lockHeld = false;
  private stopped = false;
  readonly log: Logger;

  constructor(
    private readonly provider: WhatsAppProvider,
    db: PrismaClient,
    private readonly redis: RedisClient,
    private readonly bus: EventBus,
    private readonly opts: ManagerOptions,
    logger: Logger,
  ) {
    this.store = new SessionStore(db);
    this.qr = new QRManager(redis);
    this.consent = new ConsentService(db, opts.consentPolicy);
    this.messages = new MessageLogService(db);
    this.log = logger.child({ component: "WhatsAppManager" });
  }

  /** Acquires the single-worker lock, restores sessions and starts listening for commands. */
  async start(): Promise<void> {
    await this.acquireLock();
    this.heartbeat = setInterval(() => void this.beat(), (HEARTBEAT_TTL_SECONDS * 1000) / 3);
    this.heartbeat.unref?.();
    await this.beat();
    this.unsubscribe = await this.bus.subscribeCommands((c) => void this.handleCommand(c));
    await this.restore();
    this.log.info({ sessions: this.sessions.size }, "WhatsApp manager started");
  }

  /** Only one process may own the sockets. A second worker waits here until the first goes away. */
  private async acquireLock(): Promise<void> {
    for (;;) {
      if (this.stopped) throw new Error("stopped while waiting for the worker lock");
      const ok = await this.redis.set(REDIS_KEYS.workerLock, this.instanceId, "PX", WORKER_LOCK_TTL_MS, "NX");
      if (ok) break;
      this.log.warn("another worker holds the WhatsApp sessions; standing by");
      await new Promise((r) => setTimeout(r, 5000));
    }
    this.lockHeld = true;
    this.lockTimer = setInterval(() => void this.renewLock(), WORKER_LOCK_TTL_MS / 3);
    this.lockTimer.unref?.();
  }

  private async renewLock(): Promise<void> {
    try {
      const owner = await this.redis.get(REDIS_KEYS.workerLock);
      if (owner === this.instanceId) {
        await this.redis.pexpire(REDIS_KEYS.workerLock, WORKER_LOCK_TTL_MS);
        return;
      }
      if (owner === null) {
        const ok = await this.redis.set(REDIS_KEYS.workerLock, this.instanceId, "PX", WORKER_LOCK_TTL_MS, "NX");
        if (ok) return;
      }
      this.log.fatal("lost the worker lock to another process; shutting down sessions");
      this.lockHeld = false;
      await this.stop();
      process.exitCode = 1;
      process.kill(process.pid, "SIGTERM");
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, "could not renew worker lock");
    }
  }

  private async beat(): Promise<void> {
    await this.redis.set(REDIS_KEYS.workerHeartbeat, JSON.stringify({ instanceId: this.instanceId, at: new Date().toISOString(), sessions: this.sessions.size }), "EX", HEARTBEAT_TTL_SECONDS).catch(() => undefined);
  }

  get hasLock(): boolean {
    return this.lockHeld;
  }

  /** Bring back every gym that was connected (or asked to connect just before a restart). */
  async restore(): Promise<void> {
    const rows = await this.store.listRestorable();
    const window = this.opts.restoreWindowMs ?? 10 * 60_000;
    for (const r of rows) {
      const s = this.session(r.gymId);
      const saved = await this.provider.hasSavedLogin(s.authDir);
      const recentRequest = Date.now() - r.updatedAt.getTime() < window && (r.status === "QR_REQUIRED" || r.status === "CONNECTING");
      if (saved || recentRequest) {
        s.start().catch((err: Error) => this.log.error({ gymId: r.gymId, err: err.message }, "restore failed"));
      } else {
        await this.store.setStatus(r.gymId, "DISCONNECTED", { lastError: "No saved login. Press Connect to scan a QR code." });
        this.sessions.delete(r.gymId);
      }
    }
  }

  private session(gymId: string): WhatsAppSession {
    let s = this.sessions.get(gymId);
    if (!s) {
      s = new WhatsAppSession(
        gymId,
        this.provider,
        this.store,
        this.bus,
        this.qr,
        { onIncomingText: (g, from, text) => this.handleIncoming(g, from, text), onReceipt: (g, id, status) => this.handleReceipt(g, id, status) },
        this.opts,
        this.log,
      );
      this.sessions.set(gymId, s);
    }
    return s;
  }

  get(gymId: string): WhatsAppSession | undefined {
    return this.sessions.get(gymId);
  }

  async connect(gymId: string): Promise<WhatsAppSession> {
    const s = this.session(gymId);
    if (s.status === "CONNECTED") return s;
    if (s.status === "RECONNECTING" || s.status === "CONNECTING" || s.status === "QR_REQUIRED") {
      // Already trying. If the socket died silently, start() is a no-op when a client exists and a restart otherwise.
      await s.start();
      return s;
    }
    await s.start();
    return s;
  }

  async disconnect(gymId: string, logout: boolean): Promise<void> {
    const s = this.sessions.get(gymId);
    if (!s) {
      if (logout) await this.provider.clearAuth(this.session(gymId).authDir).catch(() => undefined);
      await this.store.setStatus(gymId, "DISCONNECTED", { phoneNumber: null, lastError: null, ...(logout ? { sessionLocation: null, connectedAt: null } : {}) });
      this.sessions.delete(gymId);
      return;
    }
    if (logout) await s.logout();
    else await s.stop();
    this.sessions.delete(gymId);
  }

  async handleCommand(cmd: SessionCommand): Promise<void> {
    if (this.stopped || !this.lockHeld) return;
    try {
      if (cmd.action === "connect") await this.connect(cmd.gymId);
      else if (cmd.action === "disconnect") await this.disconnect(cmd.gymId, false);
      else if (cmd.action === "logout") await this.disconnect(cmd.gymId, true);
      else if (cmd.action === "refresh") {
        const s = this.sessions.get(cmd.gymId);
        await this.bus.publish(cmd.gymId, { type: "status", data: { status: s?.status ?? "DISCONNECTED", phone: s?.phone ?? null, error: s?.lastError ?? null } });
      }
    } catch (err) {
      this.log.error({ gymId: cmd.gymId, action: cmd.action, err: (err as Error).message }, "command failed");
    }
  }

  /** Used by the queue worker. Throws WHATSAPP_NOT_CONNECTED when the gym has no live socket. */
  async send(gymId: string, recipient: string, payload: { text: string } | { media: OutgoingMedia }): Promise<{ providerMessageId: string | null }> {
    const s = this.session(gymId);
    return "text" in payload ? s.sendText(recipient, payload.text) : s.sendMedia(recipient, payload.media);
  }

  isConnected(gymId: string): boolean {
    return this.sessions.get(gymId)?.connected ?? false;
  }

  /** STOP / START keywords from members. Anything else a member writes is ignored: this is not a chat bot. */
  async handleIncoming(gymId: string, from: string, text: string): Promise<void> {
    if (matchesKeyword(text, this.opts.optOutKeywords)) {
      await this.consent.optOut(gymId, from, "keyword");
      this.log.info({ gymId }, "member opted out by keyword");
      if (this.opts.optOutReply) {
        const s = this.sessions.get(gymId);
        if (s?.connected) {
          const m = await this.messages.create({ gymId, recipient: from, message: this.opts.optOutReply, messageType: "TEXT", category: "TRANSACTIONAL", templateKey: "opt-out-confirmation" });
          try {
            const r = await s.sendText(from, this.opts.optOutReply);
            await this.messages.markSent(m.id, r.providerMessageId);
          } catch (err) {
            await this.messages.markFailed(m.id, (err as Error).message);
          }
        }
      }
    } else if (matchesKeyword(text, this.opts.optInKeywords)) {
      await this.consent.optIn(gymId, from, "keyword");
      this.log.info({ gymId }, "member opted in by keyword");
    }
  }

  async handleReceipt(gymId: string, providerMessageId: string, status: "DELIVERED" | "READ" | "FAILED"): Promise<void> {
    await this.messages.applyReceipt(gymId, providerMessageId, status);
  }

  /** Close sockets without logging out; statuses stay so the next boot restores them. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.lockTimer) {
      clearInterval(this.lockTimer);
      this.lockTimer = null;
    }
    await Promise.all([...this.sessions.values()].map((s) => s.close().catch(() => undefined)));
    this.sessions.clear();
    if (this.lockHeld) {
      const owner = await this.redis.get(REDIS_KEYS.workerLock).catch(() => null);
      if (owner === this.instanceId) await this.redis.del(REDIS_KEYS.workerLock).catch(() => undefined);
      await this.redis.del(REDIS_KEYS.workerHeartbeat).catch(() => undefined);
      this.lockHeld = false;
    }
  }
}
