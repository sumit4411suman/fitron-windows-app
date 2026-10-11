import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/index.js";
import { ConsentService } from "../../src/services/ConsentService.js";
import { MessageLogService } from "../../src/services/MessageLogService.js";
import { REDIS_KEYS } from "../../src/types/index.js";
import type { WhatsAppManager } from "../../src/whatsapp/WhatsAppManager.js";
import { sessionWorld, tick, type SessionWorld } from "../helpers/sessionWorld.js";

describe("WhatsAppManager", () => {
  let w: SessionWorld;
  let m: WhatsAppManager;
  beforeEach(async () => {
    w = await sessionWorld();
    m = w.makeManager();
    await m.start();
  });
  afterEach(async () => {
    await m.stop();
    await w.cleanup();
  });

  const linkGym = async (gymId: string, phone = "919999900000") => {
    await w.db.gym.create({ data: { id: gymId, name: gymId, apiKeyHash: `h-${gymId}`, apiKeyPrefix: "wak_x" } });
    await w.bus.publishCommand({ action: "connect", gymId, at: "" });
    await tick(30);
    await w.provider.latest(gymId).scan(phone);
    await m.get(gymId)!.waitFor((s) => s === "CONNECTED");
  };

  it("holds the single-worker lock and a heartbeat; a second manager waits", async () => {
    expect(m.hasLock).toBe(true);
    expect(await w.redis.get(REDIS_KEYS.workerLock)).toBe(m.instanceId);
    expect(await w.redis.exists(REDIS_KEYS.workerHeartbeat)).toBe(1);
    const second = w.makeManager();
    let started = false;
    const p = second.start().then(() => (started = true));
    await tick(50);
    expect(started).toBe(false);
    await m.stop();
    await p;
    expect(second.hasLock).toBe(true);
    await second.stop();
    m = w.makeManager();
    await m.start();
  });

  it("acts on commands from the API: connect, disconnect, logout", async () => {
    await linkGym("g1");
    expect(m.isConnected("g1")).toBe(true);
    await w.bus.publishCommand({ action: "disconnect", gymId: "g1", at: "" });
    await tick(40);
    expect(m.isConnected("g1")).toBe(false);
    expect((await w.store.get("g1")).status).toBe("DISCONNECTED");
    expect(await w.provider.hasSavedLogin(`${w.authRoot}/g1`)).toBe(true);
    await w.bus.publishCommand({ action: "connect", gymId: "g1", at: "" });
    await tick(60);
    await m.get("g1")!.waitFor((s) => s === "CONNECTED");
    await w.bus.publishCommand({ action: "logout", gymId: "g1", at: "" });
    await tick(40);
    expect(await w.provider.hasSavedLogin(`${w.authRoot}/g1`)).toBe(false);
    expect((await w.store.get("g1")).phone).toBeNull();
  });

  it("restores connected gyms after a restart without a QR, and drops stale connect requests", async () => {
    await linkGym("g1", "911111111111");
    await linkGym("g2", "912222222222");
    await w.db.gym.create({ data: { id: "g3", name: "g3", apiKeyHash: "h3", apiKeyPrefix: "wak_x" } });
    await w.store.setStatus("g3", "QR_REQUIRED");
    const g3 = w.db.whatsAppSession.rows.find((r) => r.gymId === "g3")!;
    g3.updatedAt = new Date(Date.now() - 3_600_000); // asked an hour ago, never scanned
    await m.stop(); // process goes down: sockets closed, logins kept, statuses untouched
    expect((await w.store.get("g1")).status).toBe("CONNECTED");
    const clientsBefore = w.provider.clients.length;

    m = w.makeManager();
    await m.start();
    await m.get("g1")!.waitFor((s) => s === "CONNECTED");
    await m.get("g2")!.waitFor((s) => s === "CONNECTED");
    expect(w.provider.clients.length).toBe(clientsBefore + 2);
    expect(m.get("g1")!.phone).toBe("911111111111");
    expect(m.get("g2")!.phone).toBe("912222222222");
    expect(w.events.filter((e) => (e.event as { type: string }).type === "qr")).toHaveLength(0);
    expect(m.get("g3")).toBeUndefined();
    expect((await w.store.get("g3")).status).toBe("DISCONNECTED");
  });

  it("STOP from a member opts them out, confirms once, and START opts back in", async () => {
    await linkGym("g1");
    const consent = new ConsentService(w.db as unknown as PrismaClient, { allowTransactionalAfterOptOut: false, requireOptInForTransactional: false });
    const client = w.provider.latest("g1");
    client.incoming("919876543210", " stop ");
    await tick(40);
    const c = await consent.get("g1", "919876543210");
    expect(c).toMatchObject({ whatsappOptIn: false, optOutSource: "keyword" });
    expect(c?.optOutAt).toBeInstanceOf(Date);
    expect(w.provider.sent.at(-1)).toMatchObject({ jid: "919876543210@s.whatsapp.net", text: "Opted out." });
    const logged = new MessageLogService(w.db as unknown as PrismaClient);
    expect((await logged.list("g1", {})).items[0]).toMatchObject({ templateKey: "opt-out-confirmation", status: "SENT" });
    expect(await consent.get("g2", "919876543210")).toBeNull(); // only this gym
    client.incoming("919876543210", "can I come at 6?");
    await tick(20);
    expect(w.provider.sent).toHaveLength(1); // chit-chat is ignored, never answered
    client.incoming("919876543210", "START");
    await tick(40);
    expect((await consent.get("g1", "919876543210"))?.whatsappOptIn).toBe(true);
  });

  it("delivery receipts move a message forward, never backward", async () => {
    await linkGym("g1");
    const log = new MessageLogService(w.db as unknown as PrismaClient);
    const row = await log.create({ gymId: "g1", recipient: "919876543210", message: "x" });
    await log.markSent(row.id, "wamid.42");
    const client = w.provider.latest("g1");
    client.receipt("wamid.42", "READ");
    await tick(30);
    expect((await log.get("g1", row.id)).status).toBe("READ");
    client.receipt("wamid.42", "DELIVERED");
    await tick(30);
    expect((await log.get("g1", row.id)).status).toBe("READ");
    client.receipt("wamid.unknown", "DELIVERED");
    await tick(10);
  });
});
