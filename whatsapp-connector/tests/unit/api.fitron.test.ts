import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prettyAmount, prettyDate } from "../../src/api/fitron/routes.js";
import { connectGym, makeGym, testWorld, type TestWorld } from "../helpers/testContainer.js";

describe("Fitron automation endpoints", () => {
  let w: TestWorld;
  let g: { gymId: string; apiKey: string };
  const auth = () => `Bearer ${g.apiKey}`;
  beforeEach(async () => {
    w = testWorld({ MAX_QUEUE_SIZE_PER_GYM: "50" });
    g = await makeGym(w, "Iron Gym", { phone: "+911234567890" });
    await connectGym(w, g.gymId);
  });

  it("renders the membership expiry template and is idempotent per member and date", async () => {
    const body = { memberId: "MEM123", name: "Rahul", phone: "+919876543210", expiryDate: "2026-10-15", membershipPlan: "Gold" };
    const res = await request(w.app).post("/api/v1/fitron/membership-expiry").set("Authorization", auth()).send(body);
    expect(res.status).toBe(202);
    expect(res.body.data.message).toBe("Hello Rahul, your Gold membership at Iron Gym expires on 15 Oct 2026. Please contact your gym for renewal.");
    expect(res.body.data.templateKey).toBe("membership-expiry");
    expect(res.body.data.memberId).toBe("MEM123");
    const again = await request(w.app).post("/api/v1/fitron/membership-expiry").set("Authorization", auth()).send(body);
    expect(again.status).toBe(200);
    expect(again.body.messageId).toBe(res.body.messageId);
    expect(w.queue.jobs).toHaveLength(1);
    const explicit = await request(w.app).post("/api/v1/fitron/membership-expiry").set("Authorization", auth()).send({ ...body, idempotencyKey: "run-2" });
    expect(explicit.status).toBe(202);
  });

  it("payment reminder, welcome, renewal, attendance and receipt", async () => {
    const pay = await request(w.app).post("/api/v1/fitron/payment-reminder").set("Authorization", auth()).send({ memberId: "MEM123", name: "Rahul", phone: "+919876543210", amount: 1500, dueDate: "2026-10-10" });
    expect(pay.status).toBe(202);
    expect(pay.body.data.message).toContain("₹1,500");
    expect(pay.body.data.message).toContain("10 Oct 2026");
    expect(pay.body.data.message).toContain("+911234567890");
    const wel = await request(w.app).post("/api/v1/fitron/welcome").set("Authorization", auth()).send({ memberId: "MEM123", name: "Rahul", phone: "+919876543210" });
    expect(wel.body.data.message).toContain("Welcome to Iron Gym, Rahul!");
    const ren = await request(w.app).post("/api/v1/fitron/renewal-reminder").set("Authorization", auth()).send({ memberId: "MEM123", name: "Rahul", phone: "+919876543210", expiryDate: "2026-09-30" });
    expect(ren.status).toBe(202);
    const att = await request(w.app).post("/api/v1/fitron/attendance").set("Authorization", auth()).send({ memberId: "MEM123", name: "Rahul", phone: "+919876543210", date: "2026-10-08", time: "07:15" });
    expect(att.body.data.message).toContain("8 Oct 2026 at 07:15");
    const rec = await request(w.app)
      .post("/api/v1/fitron/payment-receipt")
      .set("Authorization", auth())
      .field("memberId", "MEM123")
      .field("name", "Rahul")
      .field("phone", "+919876543210")
      .field("amount", "1500")
      .field("invoiceNumber", "INV-7")
      .attach("file", Buffer.from("%PDF-1.4 receipt"), { filename: "INV-7.pdf", contentType: "application/pdf" });
    expect(rec.status).toBe(202);
    expect(rec.body.data.messageType).toBe("PDF");
    expect(rec.body.data.message).toContain("₹1,500");
  });

  it("birthday is marketing: blocked without opt-in, sent with it, once a year", async () => {
    const body = { memberId: "MEM123", name: "Rahul", phone: "+919876543210" };
    const no = await request(w.app).post("/api/v1/fitron/birthday").set("Authorization", auth()).send(body);
    expect(no.status).toBe(403);
    expect(no.body.error.code).toBe("CONSENT_REQUIRED");
    await request(w.app).post("/api/v1/consent/opt-in").set("Authorization", auth()).send({ phone: "+919876543210", memberId: "MEM123" });
    expect((await request(w.app).post("/api/v1/fitron/birthday").set("Authorization", auth()).send(body)).status).toBe(202);
    expect((await request(w.app).post("/api/v1/fitron/birthday").set("Authorization", auth()).send(body)).status).toBe(200);
  });

  it("uses the gym's customised template and validates input", async () => {
    await request(w.app).put("/api/v1/templates/welcome").set("Authorization", auth()).send({ body: "Namaste {{name}} from {{gymName}}" });
    const wel = await request(w.app).post("/api/v1/fitron/welcome").set("Authorization", auth()).send({ memberId: "M", name: "Priya", phone: "+919876543210" });
    expect(wel.body.data.message).toBe("Namaste Priya from Iron Gym");
    const bad = await request(w.app).post("/api/v1/fitron/membership-expiry").set("Authorization", auth()).send({ memberId: "M", name: "Priya", phone: "+919876543210", expiryDate: "15/10/2026" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain("expiryDate");
    expect((await request(w.app).post("/api/v1/fitron/welcome").set("Authorization", auth()).send({ name: "x", phone: "+919876543210" })).status).toBe(400);
  });

  it("formats dates and amounts for members", () => {
    expect(prettyDate("2026-10-15")).toBe("15 Oct 2026");
    expect(prettyDate("garbage")).toBe("garbage");
    expect(prettyAmount(150000)).toBe("1,50,000");
    expect(prettyAmount(99.5)).toBe("99.5");
  });
});
