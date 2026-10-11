import { EventEmitter } from "node:events";

// A tiny in-memory stand-in for the ioredis commands the connector uses, with pub/sub shared across instances made by
// the same FakeRedisHub so an API-side subscriber hears a worker-side publish, as it would through a real server.

export class FakeRedisHub {
  readonly store = new Map<string, string>();
  readonly expiries = new Map<string, number>();
  readonly subscribers = new Set<FakeRedis>();
  failing = false;
  client(): FakeRedis {
    return new FakeRedis(this);
  }
}

export class FakeRedis extends EventEmitter {
  private patterns: string[] = [];
  readonly status = "ready";
  constructor(private readonly hub: FakeRedisHub) {
    super();
  }
  private check() {
    if (this.hub.failing) throw new Error("ECONNREFUSED redis is down");
  }
  private alive(key: string): boolean {
    const exp = this.hub.expiries.get(key);
    if (exp !== undefined && exp <= Date.now()) {
      this.hub.store.delete(key);
      this.hub.expiries.delete(key);
      return false;
    }
    return this.hub.store.has(key);
  }
  async get(key: string): Promise<string | null> {
    this.check();
    return this.alive(key) ? (this.hub.store.get(key) ?? null) : null;
  }
  async set(key: string, value: string, ...args: (string | number)[]): Promise<"OK" | null> {
    this.check();
    const a = args.map(String);
    if (a.includes("NX") && this.alive(key)) return null;
    this.hub.store.set(key, value);
    this.hub.expiries.delete(key);
    const px = a.indexOf("PX");
    const ex = a.indexOf("EX");
    if (px >= 0) this.hub.expiries.set(key, Date.now() + Number(a[px + 1]));
    if (ex >= 0) this.hub.expiries.set(key, Date.now() + Number(a[ex + 1]) * 1000);
    return "OK";
  }
  async del(...keys: string[]): Promise<number> {
    this.check();
    let n = 0;
    for (const k of keys) if (this.hub.store.delete(k)) n++;
    return n;
  }
  async exists(key: string): Promise<number> {
    this.check();
    return this.alive(key) ? 1 : 0;
  }
  async incr(key: string): Promise<number> {
    this.check();
    const v = (this.alive(key) ? Number(this.hub.store.get(key)) : 0) + 1;
    this.hub.store.set(key, String(v));
    return v;
  }
  async decr(key: string): Promise<number> {
    this.check();
    const v = (this.alive(key) ? Number(this.hub.store.get(key)) : 0) - 1;
    this.hub.store.set(key, String(v));
    return v;
  }
  async pexpire(key: string, ms: number): Promise<number> {
    this.check();
    if (!this.alive(key)) return 0;
    this.hub.expiries.set(key, Date.now() + ms);
    return 1;
  }
  async expire(key: string, s: number): Promise<number> {
    return this.pexpire(key, s * 1000);
  }
  async ping(): Promise<string> {
    this.check();
    return "PONG";
  }
  multi() {
    const ops: (() => Promise<unknown>)[] = [];
    const chain = {
      incr: (k: string) => (ops.push(() => this.incr(k)), chain),
      pexpire: (k: string, ms: number) => (ops.push(() => this.pexpire(k, ms)), chain),
      set: (k: string, v: string, ...a: (string | number)[]) => (ops.push(() => this.set(k, v, ...a)), chain),
      exec: async () => {
        const out: [null, unknown][] = [];
        for (const op of ops) out.push([null, await op()]);
        return out;
      },
    };
    return chain;
  }
  async publish(channel: string, message: string): Promise<number> {
    this.check();
    let n = 0;
    for (const s of this.hub.subscribers) {
      for (const p of s.patterns) {
        if (matches(p, channel)) {
          n++;
          setImmediate(() => s.emit("pmessage", p, channel, message));
          break;
        }
      }
    }
    return n;
  }
  async psubscribe(...patterns: string[]): Promise<number> {
    this.patterns.push(...patterns);
    this.hub.subscribers.add(this);
    return this.patterns.length;
  }
  async punsubscribe(): Promise<number> {
    this.patterns = [];
    this.hub.subscribers.delete(this);
    return 0;
  }
  async quit(): Promise<"OK"> {
    this.hub.subscribers.delete(this);
    return "OK";
  }
  disconnect(): void {
    this.hub.subscribers.delete(this);
  }
}

const matches = (pattern: string, channel: string) => (pattern.endsWith("*") ? channel.startsWith(pattern.slice(0, -1)) : pattern === channel);
