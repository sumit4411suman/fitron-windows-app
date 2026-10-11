import type { PrismaClient, SessionStatus } from "../generated/prisma/index.js";
import type { RedisClient } from "../config/redis.js";
import { REDIS_KEYS, type SessionSnapshot } from "../types/index.js";
import type { EventBus } from "./events.js";
import { QRManager } from "./QRManager.js";
import { SessionStore } from "./SessionStore.js";

export const WATCH_TTL_SECONDS = 90;

/**
 * The API's view of WhatsApp sessions. It never holds a socket: it reads state from the database, QR codes from Redis
 * and asks the session owner (the worker) to act through commands.
 */
export class SessionGateway {
  readonly store: SessionStore;
  readonly qr: QRManager;

  constructor(
    db: PrismaClient,
    private readonly redis: RedisClient,
    private readonly bus: EventBus,
  ) {
    this.store = new SessionStore(db);
    this.qr = new QRManager(redis);
  }

  async status(gymId: string): Promise<SessionSnapshot & { workerRunning: boolean }> {
    const [s, workerRunning] = await Promise.all([this.store.get(gymId), this.workerRunning()]);
    return { ...s, workerRunning };
  }

  async workerRunning(): Promise<boolean> {
    return (await this.redis.exists(REDIS_KEYS.workerHeartbeat)) === 1;
  }

  /** Asks the worker to open the session. Returns the status the caller should expect next. */
  async connect(gymId: string): Promise<SessionStatus> {
    const current = await this.store.get(gymId);
    if (current.status === "CONNECTED") return "CONNECTED";
    // Recorded first so a worker that boots a moment later restores the request even if it missed the command.
    const next: SessionStatus = current.status === "RECONNECTING" ? "RECONNECTING" : "QR_REQUIRED";
    await this.store.setStatus(gymId, next === "QR_REQUIRED" && current.status !== "QR_REQUIRED" ? "CONNECTING" : next, { lastError: null });
    await this.markWatched(gymId);
    await this.bus.publishCommand({ action: "connect", gymId, at: new Date().toISOString() });
    return next;
  }

  async disconnect(gymId: string, logout: boolean): Promise<void> {
    await this.bus.publishCommand({ action: logout ? "logout" : "disconnect", gymId, at: new Date().toISOString() });
    await this.qr.clear(gymId);
    await this.store.setStatus(gymId, "DISCONNECTED", { phoneNumber: null, lastError: null, ...(logout ? { sessionLocation: null, connectedAt: null } : {}) });
  }

  /** A screen is watching this gym's events stream (keeps the QR alive). */
  async markWatched(gymId: string): Promise<void> {
    await this.redis.set(REDIS_KEYS.watch(gymId), "1", "EX", WATCH_TTL_SECONDS);
  }

  async isWatched(gymId: string): Promise<boolean> {
    return (await this.redis.exists(REDIS_KEYS.watch(gymId))) === 1;
  }

  currentQr(gymId: string) {
    return this.qr.current(gymId);
  }

  subscribe = (gymId: string, handler: Parameters<EventBus["subscribe"]>[1]) => this.bus.subscribe(gymId, handler);

  requestRefresh = (gymId: string) => this.bus.publishCommand({ action: "refresh", gymId, at: new Date().toISOString() });
}
