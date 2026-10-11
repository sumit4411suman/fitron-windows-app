import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { connectGym, makeGym, testWorld, type TestWorld } from "../helpers/testContainer.js";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe("POST /api/v1/messages/send", () => {
  let w: TestWorld;
  let g: { gymId: string; apiKey: string };
  const auth = () => `Bearer ${g.apiKey}`;
  beforeEach(async () => {
    w = testWorld();
    g = await makeGym(w);
    await connectGym(w, g.gymId);
  });

  it("validates, normalises, logs and queues a text message", async () => {
    const res = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "9876543210", message: "Hello {{name}}, see you at {{gymName}}", variables: { name: "Rahul" }, memberId: "MEM1" });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ success: true, messageId: expect.any(String), data: { status: "QUEUED", recipient: "919876543210", message: "Hello Rahul, see you at Iron Gym", messageType: "TEXT", category: "TRANSACTIONAL", memberId: "MEM1" } });
    expect(w.queue.jobs).toEqual([{ messageId: res.body.messageId, gymId: g.gymId }]);
    const row = w.db.message.rows[0]!;
    expect(row.gymId).toBe(g.gymId);
    expect(row.status).toBe("QUEUED");
    expect(row.queuedAt).toBeInstanceOf(Date);
  });

  it.each([
    [{ message: "hi" }, "to"],
    [{ to: "+919876543210" }, "message"],
    [{ to: "+919876543210", message: "" }, "message"],
    [{ to: "+919876543210", message: "x".repeat(5000) }, "message"],
    [{ to: "+919876543210", message: "hi", category: "SPAM" }, "category"],
  ])("rejects invalid body %j", async (body, field) => {
    const res = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toContain(field);
  });

  it("rejects malformed JSON and invalid phone numbers", async () => {
    const bad = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    const phone = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "1234567", message: "hi" });
    expect(phone.status).toBe(400);
    expect(phone.body.error.code).toBe("INVALID_PHONE_NUMBER");
    const tpl = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "{{evil}}", variables: { evil: "x" } });
    expect(tpl.body.error.code).toBe("INVALID_TEMPLATE");
  });

  it("requires opt-in for marketing and blocks opted-out members", async () => {
    const m = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "offer", category: "MARKETING" });
    expect(m.status).toBe(403);
    expect(m.body.error.code).toBe("CONSENT_REQUIRED");
    await request(w.app).post("/api/v1/consent/opt-in").set("Authorization", auth()).send({ phone: "9876543210", memberId: "MEM1", source: "signup" });
    expect((await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "offer", category: "MARKETING" })).status).toBe(202);
    await request(w.app).post("/api/v1/consent/opt-out").set("Authorization", auth()).send({ phone: "+91 98765 43210" });
    const t = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "919876543210", message: "receipt" });
    expect(t.status).toBe(403);
    expect(t.body.error.code).toBe("OPTED_OUT");
    expect(w.queue.jobs).toHaveLength(1);
  });

  it("refuses when WhatsApp is not connected, with the right code per state", async () => {
    for (const [status, code] of [
      ["DISCONNECTED", "WHATSAPP_NOT_CONNECTED"],
      ["QR_REQUIRED", "WHATSAPP_NOT_CONNECTED"],
      ["AUTH_FAILURE", "WHATSAPP_NOT_CONNECTED"],
      ["SESSION_EXPIRED", "SESSION_EXPIRED"],
    ] as const) {
      await w.c.sessions.store.setStatus(g.gymId, status);
      const res = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "hi" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(code);
    }
    // a short outage still accepts: the queue waits for the reconnect
    await w.c.sessions.store.setStatus(g.gymId, "RECONNECTING");
    expect((await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "hi" })).status).toBe(202);
  });

  it("stops at the per-gym queue limit", async () => {
    for (let i = 0; i < 5; i++) expect((await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: `m${i}` })).status).toBe(202);
    const full = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "one more" });
    expect(full.status).toBe(429);
    expect(full.body.error.code).toBe("MESSAGE_QUEUE_FULL");
  });

  it("is idempotent on idempotencyKey", async () => {
    const first = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "once", idempotencyKey: "evt-1" });
    const second = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "once again", idempotencyKey: "evt-1" });
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.messageId).toBe(first.body.messageId);
    expect(second.body.data.duplicate).toBe(true);
    expect(w.queue.jobs).toHaveLength(1);
  });

  it("fails cleanly when the queue (Redis) is down", async () => {
    w.queue.failing = true;
    const res = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "hi" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(w.db.message.rows[0]!.status).toBe("FAILED");
  });

  it("cancels a queued message, and only a queued one", async () => {
    const res = await request(w.app).post("/api/v1/messages/send").set("Authorization", auth()).send({ to: "+919876543210", message: "hi" });
    const c = await request(w.app).post(`/api/v1/messages/${res.body.messageId}/cancel`).set("Authorization", auth());
    expect(c.body.data.status).toBe("CANCELLED");
    expect(w.queue.jobs).toHaveLength(0);
    expect((await request(w.app).post(`/api/v1/messages/${res.body.messageId}/cancel`).set("Authorization", auth())).status).toBe(409);
  });
});

describe("POST /api/v1/messages/document", () => {
  let w: TestWorld;
  let g: { gymId: string; apiKey: string };
  beforeEach(async () => {
    w = testWorld();
    g = await makeGym(w);
    await connectGym(w, g.gymId);
  });

  it("accepts a PDF and an image, stores the file for the worker", async () => {
    const res = await request(w.app).post("/api/v1/messages/document").set("Authorization", `Bearer ${g.apiKey}`).field("to", "+919876543210").field("caption", "Your invoice").attach("file", PDF, { filename: "invoice.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ messageType: "PDF", message: "Your invoice", mediaName: "invoice.pdf", status: "QUEUED" });
    expect(w.db.message.rows[0]!.mediaPath).toContain(g.gymId);
    const img = await request(w.app).post("/api/v1/messages/image").set("Authorization", `Bearer ${g.apiKey}`).field("to", "+919876543210").attach("file", PNG, { filename: "pic.png", contentType: "image/png" });
    expect(img.status).toBe(202);
    expect(img.body.data.messageType).toBe("IMAGE");
  });

  it.each([
    ["evil.exe", "application/x-msdownload", Buffer.from("MZ....")],
    ["script.sh", "text/x-shellscript", Buffer.from("#!/bin/sh")],
    ["fake.pdf", "application/pdf", Buffer.from("MZ this is not a pdf")],
    ["renamed.pdf", "image/png", PNG],
  ])("refuses %s", async (filename, contentType, buf) => {
    const res = await request(w.app).post("/api/v1/messages/document").set("Authorization", `Bearer ${g.apiKey}`).field("to", "+919876543210").attach("file", buf, { filename, contentType });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(w.db.message.rows).toHaveLength(0);
  });

  it("enforces the size limit and requires a file", async () => {
    const big = testWorld({ MAX_MEDIA_BYTES: "2048" });
    const gg = await makeGym(big);
    await connectGym(big, gg.gymId);
    const res = await request(big.app).post("/api/v1/messages/document").set("Authorization", `Bearer ${gg.apiKey}`).field("to", "+919876543210").attach("file", Buffer.concat([PDF, Buffer.alloc(4096)]), { filename: "big.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
    const none = await request(w.app).post("/api/v1/messages/document").set("Authorization", `Bearer ${g.apiKey}`).field("to", "+919876543210");
    expect(none.status).toBe(400);
  });
});

describe("GET /api/v1/messages", () => {
  it("filters by status, type, recipient, date and ids", async () => {
    const w = testWorld({ MAX_QUEUE_SIZE_PER_GYM: "50" });
    const g = await makeGym(w);
    await connectGym(w, g.gymId);
    const auth = `Bearer ${g.apiKey}`;
    const ids: string[] = [];
    for (const to of ["+919876543210", "+919876543211", "+919876543210"]) {
      ids.push((await request(w.app).post("/api/v1/messages/send").set("Authorization", auth).send({ to, message: "x" })).body.messageId);
      await new Promise((r) => setTimeout(r, 3)); // distinct createdAt, so "newest first" is deterministic
    }
    await w.c.messageLog.markSent(ids[0]!, "wamid.1");
    await w.c.messageLog.markFailed(ids[1]!, "boom");
    const all = await request(w.app).get("/api/v1/messages").set("Authorization", auth);
    expect(all.body.data.items).toHaveLength(3);
    expect(all.body.data.items[0].messageId).toBe(ids[2]); // newest first
    expect((await request(w.app).get("/api/v1/messages?status=SENT").set("Authorization", auth)).body.data.items.map((m: { messageId: string }) => m.messageId)).toEqual([ids[0]]);
    expect((await request(w.app).get("/api/v1/messages?status=FAILED").set("Authorization", auth)).body.data.items[0].error).toBe("boom");
    expect((await request(w.app).get("/api/v1/messages?recipient=9876543211").set("Authorization", auth)).body.data.items).toHaveLength(1);
    expect((await request(w.app).get("/api/v1/messages?messageType=TEXT").set("Authorization", auth)).body.data.items).toHaveLength(3);
    expect((await request(w.app).get("/api/v1/messages?messageType=PDF").set("Authorization", auth)).body.data.items).toHaveLength(0);
    const today = new Date().toISOString().slice(0, 10);
    expect((await request(w.app).get(`/api/v1/messages?date=${today}`).set("Authorization", auth)).body.data.items).toHaveLength(3);
    expect((await request(w.app).get("/api/v1/messages?date=2000-01-01").set("Authorization", auth)).body.data.items).toHaveLength(0);
    expect((await request(w.app).get(`/api/v1/messages?ids=${ids[0]},${ids[1]}`).set("Authorization", auth)).body.data.items).toHaveLength(2);
    const page = await request(w.app).get("/api/v1/messages?limit=2").set("Authorization", auth);
    expect(page.body.data.items).toHaveLength(2);
    expect(page.body.data.nextCursor).toBe(ids[1]);
    const next = await request(w.app).get(`/api/v1/messages?limit=2&cursor=${page.body.data.nextCursor}`).set("Authorization", auth);
    expect(next.body.data.items.map((m: { messageId: string }) => m.messageId)).toEqual([ids[0]]);
    expect((await request(w.app).get("/api/v1/messages?status=NOPE").set("Authorization", auth)).status).toBe(400);
    const keyed = (await request(w.app).post("/api/v1/messages/send").set("Authorization", auth).send({ to: "+919876543210", message: "k", idempotencyKey: "fitron-77" })).body.messageId;
    const byKey = await request(w.app).get("/api/v1/messages?idempotencyKeys=fitron-77,unknown").set("Authorization", auth);
    expect(byKey.body.data.items.map((m: { messageId: string }) => m.messageId)).toEqual([keyed]);
  });
});
