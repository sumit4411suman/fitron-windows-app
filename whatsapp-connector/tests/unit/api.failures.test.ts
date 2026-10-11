import request from "supertest";
import { describe, expect, it } from "vitest";
import { connectGym, makeGym, testWorld } from "../helpers/testContainer.js";

describe("health, readiness and backing-service failures", () => {
  it("/health and /ready reflect database, redis and the worker", async () => {
    const w = testWorld();
    let h = await request(w.app).get("/health");
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ status: "degraded", database: "connected", redis: "connected", whatsapp: "stopped" });
    await w.hub.client().set("wa:worker:heartbeat", "1", "EX", 20);
    h = await request(w.app).get("/health");
    expect(h.body.status).toBe("healthy");
    expect(h.body.whatsapp).toBe("running");
    expect((await request(w.app).get("/ready")).body).toEqual({ ready: true, database: "connected", redis: "connected" });

    w.db.failing = true;
    h = await request(w.app).get("/health");
    expect(h.status).toBe(503);
    expect(h.body).toMatchObject({ status: "unhealthy", database: "disconnected" });
    expect((await request(w.app).get("/ready")).status).toBe(503);
    w.db.failing = false;
    w.hub.failing = true;
    h = await request(w.app).get("/health");
    expect(h.body.redis).toBe("disconnected");
    expect(h.status).toBe(503);
  });

  it("a database outage gives 503 SERVICE_UNAVAILABLE, not a 500 or a leak", async () => {
    const w = testWorld();
    const g = await makeGym(w);
    await connectGym(w, g.gymId);
    w.db.failing = true;
    const res = await request(w.app).post("/api/v1/messages/send").set("Authorization", `Bearer ${g.apiKey}`).send({ to: "+919876543210", message: "hi" });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: expect.any(String) } });
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|P1001/i);
    w.db.failing = false;
    expect((await request(w.app).post("/api/v1/messages/send").set("Authorization", `Bearer ${g.apiKey}`).send({ to: "+919876543210", message: "hi" })).status).toBe(202);
  });

  it("a redis outage during a session call gives 503", async () => {
    const w = testWorld();
    const g = await makeGym(w);
    w.hub.failing = true;
    const res = await request(w.app).post("/api/v1/whatsapp/connect").set("Authorization", `Bearer ${g.apiKey}`);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("unknown routes and responses never carry secrets", async () => {
    const w = testWorld();
    const res = await request(w.app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-request-id"]).toBeTruthy();
    const docs = await request(w.app).get("/openapi.json");
    expect(docs.status).toBe(200);
    expect(docs.body.paths["/api/v1/whatsapp/connect"]).toBeTruthy();
    expect(JSON.stringify(docs.body)).not.toContain(w.masterKey);
  });

  it("applies CORS only to configured origins", async () => {
    const w = testWorld();
    const ok = await request(w.app).options("/api/v1/whatsapp/status").set("Origin", "https://www.fitron.in").set("Access-Control-Request-Method", "GET");
    expect(ok.headers["access-control-allow-origin"]).toBe("https://www.fitron.in");
    const bad = await request(w.app).options("/api/v1/whatsapp/status").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
