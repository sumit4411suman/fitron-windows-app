import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { connectGym, makeGym, testWorld, type TestWorld } from "../helpers/testContainer.js";

describe("API key authentication", () => {
  let w: TestWorld;
  beforeEach(() => (w = testWorld()));

  it("creates a gym with the master key and returns the key once", async () => {
    const res = await request(w.app).post("/api/v1/gyms").set("Authorization", `Bearer ${w.masterKey}`).send({ name: "Iron Gym", externalId: "org_1" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.apiKey).toMatch(/^wak_[0-9a-f]{48}$/);
    expect(res.body.data.gymId).toBeTruthy();
    const stored = w.db.gym.rows[0]!;
    expect(stored.apiKeyHash).not.toContain(res.body.data.apiKey);
    expect(JSON.stringify(stored)).not.toContain(res.body.data.apiKey);
    // the key is never returned again
    const again = await request(w.app).get(`/api/v1/gyms/${res.body.data.gymId}`).set("Authorization", `Bearer ${w.masterKey}`);
    expect(again.body.data.apiKey).toBeUndefined();
    expect(again.body.data.apiKeyPrefix).toBe(res.body.data.apiKey.slice(0, 10));
    const dup = await request(w.app).post("/api/v1/gyms").set("Authorization", `Bearer ${w.masterKey}`).send({ name: "Again", externalId: "org_1" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE_REQUEST");
    const byExt = await request(w.app).get("/api/v1/gyms/by-external/org_1").set("Authorization", `Bearer ${w.masterKey}`);
    expect(byExt.body.data.gymId).toBe(res.body.data.gymId);
  });

  it("refuses admin calls without the master key, and a gym key is not a master key", async () => {
    expect((await request(w.app).post("/api/v1/gyms").send({ name: "x" })).status).toBe(401);
    expect((await request(w.app).post("/api/v1/gyms").set("Authorization", "Bearer nope").send({ name: "x" })).body.error.code).toBe("INVALID_API_KEY");
    const g = await makeGym(w);
    expect((await request(w.app).get("/api/v1/gyms").set("Authorization", `Bearer ${g.apiKey}`)).status).toBe(401);
  });

  it("authenticates gym endpoints by bearer key and rejects bad or missing keys", async () => {
    const g = await makeGym(w);
    const ok = await request(w.app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${g.apiKey}`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("DISCONNECTED");
    const me = await request(w.app).get("/api/v1/gyms/me").set("Authorization", `Bearer ${g.apiKey}`);
    expect(me.body.data.gymId).toBe(g.gymId);
    for (const h of [undefined, "Bearer", "Bearer wak_" + "0".repeat(48), "Basic abc", `Bearer ${w.masterKey}`]) {
      const r = h ? request(w.app).get("/api/v1/whatsapp/status").set("Authorization", h) : request(w.app).get("/api/v1/whatsapp/status");
      const res = await r;
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(["UNAUTHORIZED", "INVALID_API_KEY"]).toContain(res.body.error.code);
    }
  });

  it("rotating the key invalidates the old one; suspending or deleting a gym blocks it", async () => {
    const g = await makeGym(w);
    const rot = await request(w.app).post(`/api/v1/gyms/${g.gymId}/rotate-key`).set("Authorization", `Bearer ${w.masterKey}`);
    expect(rot.body.data.apiKey).toMatch(/^wak_/);
    expect((await request(w.app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${g.apiKey}`)).status).toBe(401);
    expect((await request(w.app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${rot.body.data.apiKey}`)).status).toBe(200);
    await request(w.app).patch(`/api/v1/gyms/${g.gymId}`).set("Authorization", `Bearer ${w.masterKey}`).send({ status: "SUSPENDED" });
    const sus = await request(w.app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${rot.body.data.apiKey}`);
    expect(sus.status).toBe(403);
    expect(sus.body.error.code).toBe("GYM_SUSPENDED");
    await request(w.app).delete(`/api/v1/gyms/${g.gymId}`).set("Authorization", `Bearer ${w.masterKey}`);
    expect((await request(w.app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${rot.body.data.apiKey}`)).status).toBe(401);
    expect((await request(w.app).get(`/api/v1/gyms/${g.gymId}`).set("Authorization", `Bearer ${w.masterKey}`)).status).toBe(404);
  });
});

describe("gym isolation", () => {
  let w: TestWorld;
  let a: { gymId: string; apiKey: string };
  let b: { gymId: string; apiKey: string };
  beforeEach(async () => {
    w = testWorld();
    a = await makeGym(w, "Gym A");
    b = await makeGym(w, "Gym B");
    await connectGym(w, a.gymId, "911111111111");
    await connectGym(w, b.gymId, "912222222222");
  });

  it("each gym sees only its own session, QR, messages, consent and templates", async () => {
    const sa = await request(w.app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${a.apiKey}`);
    const sb = await request(w.app).get("/api/v1/whatsapp/status").set("Authorization", `Bearer ${b.apiKey}`);
    expect(sa.body.phone).toBe("+911111111111");
    expect(sb.body.phone).toBe("+912222222222");

    await w.c.sessions.qr.store(a.gymId, "data:image/png;base64,AAAA");
    await w.c.sessions.store.setStatus(a.gymId, "QR_REQUIRED");
    const qrB = await request(w.app).get("/api/v1/whatsapp/qr").set("Authorization", `Bearer ${b.apiKey}`);
    expect(qrB.body.data.qr).toBeNull();

    const sent = await request(w.app).post("/api/v1/messages/send").set("Authorization", `Bearer ${b.apiKey}`).send({ to: "+919876543210", message: "hello from B" });
    expect(sent.status).toBe(202);
    const id = sent.body.messageId;
    expect((await request(w.app).get(`/api/v1/messages/${id}`).set("Authorization", `Bearer ${a.apiKey}`)).status).toBe(404);
    expect((await request(w.app).post(`/api/v1/messages/${id}/cancel`).set("Authorization", `Bearer ${a.apiKey}`)).status).toBe(404);
    expect((await request(w.app).get("/api/v1/messages").set("Authorization", `Bearer ${a.apiKey}`)).body.data.items).toHaveLength(0);
    expect((await request(w.app).get(`/api/v1/messages?ids=${id}`).set("Authorization", `Bearer ${a.apiKey}`)).body.data.items).toHaveLength(0);
    expect((await request(w.app).get("/api/v1/messages").set("Authorization", `Bearer ${b.apiKey}`)).body.data.items).toHaveLength(1);

    await request(w.app).post("/api/v1/consent/opt-out").set("Authorization", `Bearer ${a.apiKey}`).send({ phone: "+919876543210" });
    expect((await request(w.app).get("/api/v1/consent?phone=%2B919876543210").set("Authorization", `Bearer ${b.apiKey}`)).body.data.whatsappOptIn).toBe(false);
    expect((await request(w.app).get("/api/v1/consent").set("Authorization", `Bearer ${b.apiKey}`)).body.data).toHaveLength(0);
    // B may still message the number A's member opted out from
    expect((await request(w.app).post("/api/v1/messages/send").set("Authorization", `Bearer ${b.apiKey}`).send({ to: "+919876543210", message: "still fine" })).status).toBe(202);
    expect((await request(w.app).post("/api/v1/messages/send").set("Authorization", `Bearer ${a.apiKey}`).send({ to: "+919876543210", message: "blocked" })).body.error.code).toBe("OPTED_OUT");

    await request(w.app).put("/api/v1/templates/welcome").set("Authorization", `Bearer ${a.apiKey}`).send({ body: "A says hi {{name}}" });
    expect((await request(w.app).get("/api/v1/templates/welcome").set("Authorization", `Bearer ${b.apiKey}`)).body.data.isDefault).toBe(true);
  });

  it("the session folder and auth directory are per gym", () => {
    expect(a.gymId).not.toBe(b.gymId);
    expect(w.db.whatsAppSession.rows.map((r) => r.gymId).sort()).toEqual([a.gymId, b.gymId].sort());
  });
});
