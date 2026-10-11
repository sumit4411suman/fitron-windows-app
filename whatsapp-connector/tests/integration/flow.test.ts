import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env, resetEnv } from "../../src/config/env.js";
import { prisma, setPrisma } from "../../src/config/database.js";
import { createRedis, setRedis } from "../../src/config/redis.js";
import { createApp } from "../../src/server/app.js";
import { buildContainer, type Container } from "../../src/server/container.js";
import { startWorker, type WorkerRuntime } from "../../src/server/worker.js";
import { MockProvider } from "../helpers/mockProvider.js";

// The whole system with a real Postgres, Redis and BullMQ; only WhatsApp itself is a mock. Covers the "definition of
// done" list: create gym, connect, QR, scan, connected, send, status, restart without QR, second isolated gym.

const waitFor = async (pred: () => Promise<boolean>, ms = 15_000, what = "condition") => {
  const until = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("end-to-end flow (real Postgres + Redis + BullMQ, mock WhatsApp)", () => {
  let c: Container;
  let app: ReturnType<typeof createApp>;
  let server: Server;
  let base: string;
  let worker: WorkerRuntime;
  let provider: MockProvider;
  let master: string;
  let sessionsDir: string;

  beforeAll(async () => {
    sessionsDir = await mkdtemp(join(tmpdir(), "wa-int-"));
    process.env.SESSION_STORAGE_PATH = join(sessionsDir, "sessions");
    process.env.MEDIA_STORAGE_PATH = join(sessionsDir, "media");
    process.env.MAX_QUEUE_SIZE_PER_GYM = "50";
    resetEnv();
    const e = env();
    master = e.WA_CONNECTOR_MASTER_KEY;
    setPrisma(null);
    setRedis(null);
    const db = prisma();
    await db.$executeRawUnsafe('TRUNCATE "Message", "Consent", "Template", "WhatsAppSession", "Gym" CASCADE');
    const redis = createRedis("test-main");
    setRedis(redis);
    await redis.flushdb();
    c = buildContainer({ env: e, db, redis, subscriber: createRedis("test-sub") });
    app = createApp(c);
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    provider = new MockProvider();
    worker = await startWorker(c, provider);
  });

  afterAll(async () => {
    await worker?.stop();
    await new Promise<void>((r) => server?.close(() => r()));
    await c?.close();
    await c?.redis.quit().catch(() => undefined);
    await c?.db.$disconnect();
    await rm(sessionsDir, { recursive: true, force: true });
  });

  const gymA = { gymId: "", apiKey: "" };
  const gymB = { gymId: "", apiKey: "" };

  it("1-2. creates two gyms with their own API keys", async () => {
    const a = await request(app).post("/api/v1/gyms").set("Authorization", `Bearer ${master}`).send({ name: "Gym A", externalId: "org_a", phone: "+911111111111" });
    const b = await request(app).post("/api/v1/gyms").set("Authorization", `Bearer ${master}`).send({ name: "Gym B", externalId: "org_b" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    Object.assign(gymA, { gymId: a.body.data.gymId, apiKey: a.body.data.apiKey });
    Object.assign(gymB, { gymId: b.body.data.gymId, apiKey: b.body.data.apiKey });
    expect((await request(app).get("/health")).body).toMatchObject({ status: "healthy", database: "connected", redis: "connected", whatsapp: "running" });
  });

  it("3-8. connect -> QR over SSE -> scan -> CONNECTED with the phone number", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/v1/whatsapp/events`, { headers: { Authorization: `Bearer ${gymA.apiKey}` }, signal: ctrl.signal });
    const reader = res.body!.getReader();
    let buf = "";
    const dec = new TextDecoder();
    const readUntil = async (needle: string) => {
      const until = Date.now() + 10_000;
      while (!buf.includes(needle)) {
        if (Date.now() > until) throw new Error(`no "${needle}" in stream:\n${buf}`);
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buf += dec.decode(value);
      }
    };
    await readUntil('"status":"DISCONNECTED"');

    const connect = await request(app).post("/api/v1/whatsapp/connect").set("Authorization", `Bearer ${gymA.apiKey}`);
    expect(connect.body).toMatchObject({ success: true, status: "QR_REQUIRED" });
    await waitFor(async () => provider.clients.some((x) => x.gymId === gymA.gymId), 10_000, "worker to open a socket");
    provider.latest(gymA.gymId).emitQr("2@pairing-payload");
    await readUntil("event: qr\n");
    expect(buf).toContain('"data":"data:image/png;base64,');
    expect(buf).not.toContain("2@pairing-payload");
    const qrNow = await request(app).get("/api/v1/whatsapp/qr").set("Authorization", `Bearer ${gymA.apiKey}`);
    expect(qrNow.body.data.qr).toMatch(/^data:image\/png;base64,/);

    await provider.latest(gymA.gymId).scan("919000000001");
    await readUntil('"status":"CONNECTED","phone":"+919000000001"');
    ctrl.abort();
    const st = await request(app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${gymA.apiKey}`);
    expect(st.body).toMatchObject({ connected: true, status: "CONNECTED", phone: "+919000000001" });
  });

  it("9-10. sends a test message through the queue and shows its status", async () => {
    const res = await request(app).post("/api/v1/messages/send").set("Authorization", `Bearer ${gymA.apiKey}`).send({ to: "+919876543210", message: "Fitron test message", idempotencyKey: "test-1" });
    expect(res.status).toBe(202);
    const id = res.body.messageId;
    await waitFor(async () => (await request(app).get(`/api/v1/messages/${id}`).set("Authorization", `Bearer ${gymA.apiKey}`)).body.data.status === "SENT", 15_000, "message to be sent");
    const m = await request(app).get(`/api/v1/messages/${id}`).set("Authorization", `Bearer ${gymA.apiKey}`);
    expect(m.body.data).toMatchObject({ status: "SENT", providerMessageId: "wamid.1", recipient: "919876543210" });
    expect(provider.sent[0]).toMatchObject({ gymId: gymA.gymId, jid: "919876543210@s.whatsapp.net", text: "Fitron test message" });
    // delivery receipt from the phone
    provider.latest(gymA.gymId).receipt("wamid.1", "DELIVERED");
    await waitFor(async () => (await request(app).get(`/api/v1/messages/${id}`).set("Authorization", `Bearer ${gymA.apiKey}`)).body.data.status === "DELIVERED", 5000, "receipt");
    // the same idempotency key does not send twice
    const dup = await request(app).post("/api/v1/messages/send").set("Authorization", `Bearer ${gymA.apiKey}`).send({ to: "+919876543210", message: "Fitron test message", idempotencyKey: "test-1" });
    expect(dup.status).toBe(200);
    expect(provider.sent).toHaveLength(1);
    // a Fitron event with a PDF
    const rec = await request(app).post("/api/v1/fitron/payment-receipt").set("Authorization", `Bearer ${gymA.apiKey}`).field("memberId", "M1").field("name", "Rahul").field("phone", "+919876543210").field("amount", "1500").attach("file", Buffer.from("%PDF-1.4 x"), { filename: "inv.pdf", contentType: "application/pdf" });
    expect(rec.status).toBe(202);
    await waitFor(async () => provider.sent.length === 2, 15_000, "pdf to be sent");
    expect(provider.sent[1]!.media).toMatchObject({ kind: "document", fileName: "inv.pdf", mimeType: "application/pdf" });
    const st = await request(app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${gymA.apiKey}`);
    expect(st.body.data.today.sent).toBe(2);
  });

  it("11-12. after a worker restart the session comes back without a QR scan, and queued messages go out", async () => {
    const clientsBefore = provider.clients.length;
    await worker.stop();
    expect((await request(app).get("/health")).body.whatsapp).toBe("stopped");
    // a message queued while the worker is down waits (status RECONNECTING/CONNECTED accepted; DB still says CONNECTED)
    const queued = await request(app).post("/api/v1/messages/send").set("Authorization", `Bearer ${gymA.apiKey}`).send({ to: "+919876543210", message: "while you were away" });
    expect(queued.status).toBe(202);

    worker = await startWorker(c, provider);
    await waitFor(async () => (await request(app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${gymA.apiKey}`)).body.status === "CONNECTED", 15_000, "restore");
    expect(provider.clients.length).toBe(clientsBefore + 1);
    expect(provider.clients.filter((x) => x.gymId === gymA.gymId).length).toBe(2);
    const st = await request(app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${gymA.apiKey}`);
    expect(st.body.phone).toBe("+919000000001");
    await waitFor(async () => (await request(app).get(`/api/v1/messages/${queued.body.messageId}`).set("Authorization", `Bearer ${gymA.apiKey}`)).body.data.status === "SENT", 20_000, "queued message after restart");
  });

  it("13-14. a second gym gets a completely separate session and cannot see the first gym's data", async () => {
    const connect = await request(app).post("/api/v1/whatsapp/connect").set("Authorization", `Bearer ${gymB.apiKey}`);
    expect(connect.body.status).toBe("QR_REQUIRED");
    await waitFor(async () => provider.clients.some((x) => x.gymId === gymB.gymId), 10_000, "gym B socket");
    await provider.latest(gymB.gymId).scan("919000000002");
    await waitFor(async () => (await request(app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${gymB.apiKey}`)).body.status === "CONNECTED", 10_000, "gym B connected");
    expect((await request(app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${gymB.apiKey}`)).body.phone).toBe("+919000000002");
    expect((await request(app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${gymA.apiKey}`)).body.phone).toBe("+919000000001");
    expect(provider.latest(gymA.gymId).authDir).not.toBe(provider.latest(gymB.gymId).authDir);

    const listB = await request(app).get("/api/v1/messages").set("Authorization", `Bearer ${gymB.apiKey}`);
    expect(listB.body.data.items).toHaveLength(0);
    const aMessage = (await request(app).get("/api/v1/messages").set("Authorization", `Bearer ${gymA.apiKey}`)).body.data.items[0].messageId;
    expect((await request(app).get(`/api/v1/messages/${aMessage}`).set("Authorization", `Bearer ${gymB.apiKey}`)).status).toBe(404);
    expect((await request(app).get("/api/v1/whatsapp/qr").set("Authorization", `Bearer ${gymB.apiKey}`)).body.data.qr).toBeNull();

    // STOP from a member of gym B only affects gym B
    provider.latest(gymB.gymId).incoming("919876543210", "STOP");
    await waitFor(async () => (await request(app).get("/api/v1/consent?phone=%2B919876543210").set("Authorization", `Bearer ${gymB.apiKey}`)).body.data.optOutAt !== null, 5000, "opt-out");
    expect((await request(app).post("/api/v1/messages/send").set("Authorization", `Bearer ${gymB.apiKey}`).send({ to: "+919876543210", message: "x" })).body.error.code).toBe("OPTED_OUT");
    expect((await request(app).post("/api/v1/messages/send").set("Authorization", `Bearer ${gymA.apiKey}`).send({ to: "+919876543210", message: "fine for A" })).status).toBe(202);

    // disconnect gym B: logged out, login removed, history kept
    await request(app).post("/api/v1/whatsapp/disconnect").set("Authorization", `Bearer ${gymB.apiKey}`);
    await waitFor(async () => provider.latest(gymB.gymId).loggedOut, 5000, "logout");
    expect(await provider.hasSavedLogin(provider.latest(gymB.gymId).authDir)).toBe(false);
    expect((await request(app).get("/api/v1/consent").set("Authorization", `Bearer ${gymB.apiKey}`)).body.data).toHaveLength(1);
    expect((await request(app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${gymA.apiKey}`)).body.status).toBe("CONNECTED");
  });
});
