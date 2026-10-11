import { EventEmitter } from "node:events";
import type { RedisClient } from "../config/redis.js";
import { REDIS_KEYS, type SessionCommand, type SessionEvent } from "../types/index.js";
import { logger } from "../utils/logger.js";

// Redis pub/sub between the API process(es) and the process that owns the WhatsApp sockets. Events flow worker -> API
// (QR, status, message updates); commands flow API -> worker (connect, disconnect, logout).

export class EventBus {
  private readonly local = new EventEmitter();
  private subscribed = false;
  private readonly sub: RedisClient;

  /** `pub` runs commands; `sub` is a dedicated connection that will be put into subscriber mode. */
  constructor(
    private readonly pub: RedisClient,
    subscriber: RedisClient,
  ) {
    this.sub = subscriber;
    this.local.setMaxListeners(0);
  }

  async publish(gymId: string, event: SessionEvent): Promise<void> {
    await this.pub.publish(REDIS_KEYS.events(gymId), JSON.stringify(event));
  }

  async publishCommand(cmd: SessionCommand): Promise<number> {
    return this.pub.publish(REDIS_KEYS.control, JSON.stringify(cmd));
  }

  /** Listen for one gym's events. Returns the unsubscribe function. */
  async subscribe(gymId: string, handler: (e: SessionEvent) => void): Promise<() => void> {
    await this.ensureSubscribed();
    const key = `events:${gymId}`;
    this.local.on(key, handler);
    return () => this.local.off(key, handler);
  }

  async subscribeCommands(handler: (c: SessionCommand) => void): Promise<() => void> {
    await this.ensureSubscribed();
    this.local.on("control", handler);
    return () => this.local.off("control", handler);
  }

  private async ensureSubscribed(): Promise<void> {
    if (this.subscribed) return;
    this.subscribed = true;
    this.sub.on("pmessage", (_pattern: string, channel: string, raw: string) => {
      try {
        const payload = JSON.parse(raw) as unknown;
        if (channel === REDIS_KEYS.control) this.local.emit("control", payload as SessionCommand);
        else if (channel.startsWith("wa:events:")) this.local.emit(`events:${channel.slice("wa:events:".length)}`, payload as SessionEvent);
      } catch (err) {
        logger.warn({ err: (err as Error).message, channel }, "bad pub/sub payload");
      }
    });
    await this.sub.psubscribe("wa:events:*", REDIS_KEYS.control);
  }

  async close(): Promise<void> {
    this.local.removeAllListeners();
    await this.sub.punsubscribe().catch(() => undefined);
  }
}
