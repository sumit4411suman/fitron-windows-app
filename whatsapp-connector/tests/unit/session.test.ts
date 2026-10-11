import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionWorld, tick, waitUntil, type SessionWorld } from "../helpers/sessionWorld.js";

describe("WhatsAppSession state machine", () => {
  let w: SessionWorld;
  beforeEach(async () => (w = await sessionWorld()));
  afterEach(() => w.cleanup());

  it("QR_REQUIRED -> CONNECTED on scan, publishing the QR image and status events", async () => {
    await w.watch("g1");
    const s = w.makeSession("g1");
    await s.start();
    expect(s.status).toBe("QR_REQUIRED");
    const client = w.provider.latest("g1");
    client.emitQr("1@abc,def");
    await s.waitFor((st) => st === "QR_REQUIRED");
    await waitUntil(() => w.events.some((e) => (e.event as { type: string }).type === "qr"));
    const qrEvent = w.events.find((e) => (e.event as { type: string }).type === "qr")!.event as { data: string; expiresAt: string };
    expect(qrEvent.data).toMatch(/^data:image\/png;base64,/);
    expect(await w.qr.current("g1")).toMatchObject({ dataUrl: qrEvent.data });
    expect(JSON.stringify(w.events)).not.toContain("1@abc,def"); // the raw payload is never published
    await client.scan("919999900000");
    await s.waitFor((st) => st === "CONNECTED");
    expect(s.phone).toBe("919999900000");
    expect(await w.qr.current("g1")).toBeNull();
    const row = await w.store.get("g1");
    expect(row).toMatchObject({ status: "CONNECTED", phone: "919999900000" });
    expect(row.connectedAt).toBeInstanceOf(Date);
    const statuses = w.events.map((e) => e.event as { type: string; data: { status?: string } }).filter((e) => e.type === "status").map((e) => e.data.status);
    expect(statuses).toEqual(["QR_REQUIRED", "CONNECTED"]);
  });

  it("reconnects after a dropped connection with backoff, without a new QR", async () => {
    const s = w.makeSession("g1");
    await s.start();
    await w.provider.latest("g1").scan();
    await s.waitFor((st) => st === "CONNECTED");
    const first = w.provider.clients.length;
    w.provider.latest("g1").drop("other", 428);
    await s.waitFor((st) => st === "RECONNECTING");
    await s.waitFor((st) => st === "CONNECTED", 2000); // the mock auto-opens because a login is saved
    expect(w.provider.clients.length).toBe(first + 1);
    expect(s.phone).toBe("919999900000");
  });

  it("restartRequired reconnects at once", async () => {
    const s = w.makeSession("g1");
    await s.start();
    await w.provider.latest("g1").scan();
    await s.waitFor((st) => st === "CONNECTED");
    w.provider.latest("g1").drop("restartRequired", 515);
    await s.waitFor((st) => st === "CONNECTED", 2000);
  });

  it("a logged-out device becomes SESSION_EXPIRED, credentials are wiped and nothing reconnects", async () => {
    const s = w.makeSession("g1");
    await s.start();
    await w.provider.latest("g1").scan();
    await s.waitFor((st) => st === "CONNECTED");
    const n = w.provider.clients.length;
    w.provider.latest("g1").drop("loggedOut", 401);
    await s.waitFor((st) => st === "SESSION_EXPIRED");
    await tick(200);
    expect(w.provider.clients.length).toBe(n);
    expect(await w.provider.hasSavedLogin(s.authDir)).toBe(false);
    expect(s.phone).toBeNull();
    expect((await w.store.get("g1")).lastError).toMatch(/signed this device out/);
    // a rejected pairing (never connected) is AUTH_FAILURE
    const s2 = w.makeSession("g2");
    await s2.start();
    w.provider.latest("g2").drop("loggedOut", 401);
    await s2.waitFor((st) => st === "AUTH_FAILURE");
  });

  it("gives up on a QR nobody watches, but keeps going while watched", async () => {
    w.setWatched(false);
    const s = w.makeSession("g1");
    await s.start();
    w.provider.latest("g1").emitQr();
    await s.waitFor((st) => st === "DISCONNECTED", 2000);
    expect((await w.store.get("g1")).lastError).toMatch(/nobody scanned/);

    w.setWatched(true);
    const s2 = w.makeSession("g2");
    await s2.start();
    w.provider.latest("g2").emitQr();
    await tick(400);
    expect(s2.status).toBe("QR_REQUIRED");
    // when the pairing socket times out while watched, a fresh socket is opened for new QR codes
    const before = w.provider.clients.length;
    w.provider.latest("g2").drop("timedOut", 408);
    await tick(100);
    expect(w.provider.clients.length).toBe(before + 1);
    await s2.close();
  });

  it("stop keeps the login (restart without QR); logout removes it", async () => {
    const s = w.makeSession("g1");
    await s.start();
    await w.provider.latest("g1").scan();
    await s.waitFor((st) => st === "CONNECTED");
    await s.stop();
    expect(s.status).toBe("DISCONNECTED");
    expect(await w.provider.hasSavedLogin(s.authDir)).toBe(true);
    // a new process: a fresh session object over the same folder
    const again = w.makeSession("g1");
    await again.start();
    expect(again.status).toBe("CONNECTING");
    await again.waitFor((st) => st === "CONNECTED");
    expect(w.provider.latest("g1").handlers).toBeTruthy();
    await again.logout();
    expect(w.provider.latest("g1").loggedOut).toBe(true);
    expect(await w.provider.hasSavedLogin(again.authDir)).toBe(false);
    expect(again.phone).toBeNull();
    expect((await w.store.get("g1")).phone).toBeNull();
  });

  it("refuses to send unless connected and reports numbers not on WhatsApp", async () => {
    const s = w.makeSession("g1");
    await expect(s.sendText("919876543210", "hi")).rejects.toMatchObject({ code: "WHATSAPP_NOT_CONNECTED" });
    await s.start();
    await w.provider.latest("g1").scan();
    await s.waitFor((st) => st === "CONNECTED");
    const r = await s.sendText("919876543210", "hi");
    expect(r.providerMessageId).toBe("wamid.1");
    expect(w.provider.sent[0]).toMatchObject({ gymId: "g1", jid: "919876543210@s.whatsapp.net", text: "hi" });
    w.provider.notOnWhatsApp.add("919000000000");
    await expect(s.sendText("919000000000", "hi")).rejects.toMatchObject({ code: "NUMBER_NOT_ON_WHATSAPP" });
  });

  it("a provider that cannot start leaves the session DISCONNECTED with the reason", async () => {
    w.provider.createError = new Error("no network");
    const s = w.makeSession("g1");
    await expect(s.start()).rejects.toThrow("no network");
    expect(s.status).toBe("DISCONNECTED");
    expect((await w.store.get("g1")).lastError).toBe("no network");
  });
});
