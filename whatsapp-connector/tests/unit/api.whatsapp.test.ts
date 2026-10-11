import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionCommand } from "../../src/types/index.js";
import { connectGym, makeGym, testWorld, type TestWorld } from "../helpers/testContainer.js";

describe("WhatsApp session endpoints", () => {
  let w: TestWorld;
  let g: { gymId: string; apiKey: string };
  const auth = () => `Bearer ${g.apiKey}`;
  beforeEach(async () => {
    w = testWorld();
    g = await makeGym(w);
  });

  it("connect needs a running worker, records the request and sends the command", async () => {
    const down = await request(w.app).post("/api/v1/whatsapp/connect").set("Authorization", auth());
    expect(down.status).toBe(503);
    await w.hub.client().set("wa:worker:heartbeat", "1", "EX", 20);
    const commands: SessionCommand[] = [];
    await w.c.bus.subscribeCommands((c) => commands.push(c));
    const res = await request(w.app).post("/api/v1/whatsapp/connect").set("Authorization", auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: "QR_REQUIRED" });
    await new Promise((r) => setTimeout(r, 10));
    expect(commands).toEqual([{ action: "connect", gymId: g.gymId, at: expect.any(String) }]);
    expect((await w.c.sessions.status(g.gymId)).status).toBe("CONNECTING");
    expect(await w.c.sessions.isWatched(g.gymId)).toBe(true);
    // connecting while connected is a no-op
    await connectGym(w, g.gymId);
    expect((await request(w.app).post("/api/v1/whatsapp/connect").set("Authorization", auth())).body.status).toBe("CONNECTED");
  });

  it("status reports the phone and today's counts", async () => {
    await connectGym(w, g.gymId, "919876500000");
    await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "a" });
    const id = (await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "b" })).body.messageId;
    await w.c.messageLog.markSent(id, "wamid.9");
    const res = await request(w.app).get("/api/v1/whatsapp/status").set("Authorization", auth());
    expect(res.body).toMatchObject({ success: true, connected: true, status: "CONNECTED", phone: "+919876500000", data: { phoneFormatted: "+91 98765 00000", today: { sent: 1, failed: 0 }, queued: 1, workerRunning: true, limits: { perMinute: 10 } } });
  });

  it("qr endpoint returns the stored code only while waiting for a scan", async () => {
    expect((await request(w.app).get("/api/v1/whatsapp/qr").set("Authorization", auth())).body.data).toEqual({ status: "DISCONNECTED", qr: null });
    await w.c.sessions.store.setStatus(g.gymId, "QR_REQUIRED");
    const none = await request(w.app).get("/api/v1/whatsapp/qr").set("Authorization", auth());
    expect(none.status).toBe(410);
    expect(none.body.error.code).toBe("QR_EXPIRED");
    await w.c.sessions.qr.store(g.gymId, "data:image/png;base64,QR");
    const got = await request(w.app).get("/api/v1/whatsapp/qr").set("Authorization", auth());
    expect(got.body.data.qr).toBe("data:image/png;base64,QR");
  });

  it("disconnect logs out by default, keeps history, and clears the QR", async () => {
    await connectGym(w, g.gymId);
    await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "keep me" });
    await request(w.app).post("/api/v1/consent/opt-in").set("Authorization", auth()).send({ phone: "+919876543210" });
    const commands: SessionCommand[] = [];
    await w.c.bus.subscribeCommands((c) => commands.push(c));
    const res = await request(w.app).post("/api/v1/whatsapp/disconnect").set("Authorization", auth());
    expect(res.body.data).toEqual({ status: "DISCONNECTED", loggedOut: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(commands[0]?.action).toBe("logout");
    const st = await w.c.sessions.status(g.gymId);
    expect(st.status).toBe("DISCONNECTED");
    expect(st.phone).toBeNull();
    expect(w.db.message.rows).toHaveLength(1);
    expect(w.db.consent.rows).toHaveLength(1);
    await request(w.app).post("/api/v1/whatsapp/disconnect").set("Authorization", auth()).send({ logout: false });
    expect(commands[1]?.action).toBe("disconnect");
  });

  it("streams status and QR events over SSE", async () => {
    await w.c.sessions.store.setStatus(g.gymId, "QR_REQUIRED");
    await w.c.sessions.qr.store(g.gymId, "data:image/png;base64,FIRST");
    const server = createServer(w.app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/whatsapp/events`, { headers: { Authorization: auth() }, signal: ctrl.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const readUntil = async (needle: string) => {
      while (!buf.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buf += dec.decode(value);
      }
    };
    await readUntil("FIRST");
    expect(buf).toContain('event: status\ndata: {"type":"status","data":{"status":"QR_REQUIRED"');
    expect(buf).toContain("event: qr\n");
    // a worker publishes a new QR and then the connected status
    await w.c.bus.publish(g.gymId, { type: "qr", data: "data:image/png;base64,SECOND", expiresAt: new Date().toISOString() });
    await readUntil("SECOND");
    await w.c.bus.publish(g.gymId, { type: "status", data: { status: "CONNECTED", phone: "919999900000" } });
    await readUntil('"status":"CONNECTED","phone":"+919999900000"');
    // the other gym's events never arrive here
    const other = await makeGym(w, "Other");
    await w.c.bus.publish(other.gymId, { type: "qr", data: "data:image/png;base64,LEAK", expiresAt: "" });
    await new Promise((r) => setTimeout(r, 30));
    expect(buf).not.toContain("LEAK");
    expect(await w.c.sessions.isWatched(g.gymId)).toBe(true);
    ctrl.abort();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("rejects the stream without a key", async () => {
    expect((await request(w.app).get("/api/v1/whatsapp/events")).status).toBe(401);
  });
});
