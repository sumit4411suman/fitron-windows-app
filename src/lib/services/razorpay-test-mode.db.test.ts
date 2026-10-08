import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasDb } from "@/test/db";
import { RAZORPAY_PLANS } from "@/lib/domain/razorpay-plans";
import { findOrCreateTrainer, startTrainerPayment } from "./trainer";

const uid = () => randomUUID().slice(0, 10);
const livePlans = new Map(Object.values(RAZORPAY_PLANS).flatMap((c) => Object.values(c).map((p) => [p!.id, p!.amount] as const)));

type Plan = { id: string; period: string; interval: number; item: { name: string; amount: number; currency: string } };
type Call = { method: string; path: string; body?: Record<string, unknown> };

/**
 * A stand-in for Razorpay's API. A test account only knows the plans in `plans` (none of FITRON's live plan ids exist
 * there); the live account knows the 14 live ids. Every call is recorded.
 */
function fakeRazorpay(account: "test" | "live", existing: Plan[] = []) {
  const calls: Call[] = [];
  const plans = new Map(existing.map((p) => [p.id, p]));
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const path = u.pathname.replace(/^\/v1/, "");
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, path: path + u.search, body });
      const id = path.split("/")[2] ?? "";
      if (method === "GET" && path === "/plans") return reply({ items: [...plans.values()] });
      if (method === "POST" && path === "/plans") {
        const item = body!.item as Plan["item"];
        const p: Plan = { id: `plan_test${uid()}`, period: String(body!.period), interval: Number(body!.interval), item };
        plans.set(p.id, p);
        return reply(p);
      }
      if (method === "GET" && path.startsWith("/plans/")) {
        const known = plans.get(id);
        if (known) return reply(known);
        if (account === "live" && livePlans.has(id)) return reply({ id, item: { amount: livePlans.get(id), currency: "INR" } });
        return reply({ error: { description: "The id provided does not exist" } }, 400);
      }
      if (method === "POST" && path === "/subscriptions") return reply({ id: `sub_${uid()}`, status: "created", plan_id: body?.plan_id });
      return reply({ error: { description: `fake Razorpay has no ${method} ${path}` } }, 404);
    }),
  );
  return { calls, plans, steps: () => calls.map((c) => `${c.method} ${c.path}`) };
}

const member = () => findOrCreateTrainer(`t-${uid()}@test.local`, "EMAIL", "Ravi");

describe.skipIf(!hasDb)("Razorpay test keys (database)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("with test keys, makes the plan in the test account once, then reuses it", async () => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_test_x");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "secret");
    const rz = fakeRazorpay("test");

    const first = await startTrainerPayment((await member()).id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" });
    expect(first).toMatchObject({ mode: "SUBSCRIPTION", total: 29_900, keyId: "rzp_test_x" });
    const [made] = [...rz.plans.values()];
    expect(rz.plans.size).toBe(1);
    expect(made).toMatchObject({ period: "monthly", interval: 1, item: { name: "FITRON test ai-pro monthly", amount: 29_900, currency: "INR" } });
    // Not the live plan id: that one doesn't exist in a test account.
    expect(made!.id).not.toBe(RAZORPAY_PLANS["ai-pro"]!.MONTHLY!.id);
    expect(rz.steps()).toEqual(["GET /plans?count=100&skip=0", "POST /plans", `GET /plans/${made!.id}`, "POST /subscriptions"]);
    expect(rz.calls.at(-1)!.body).toMatchObject({ plan_id: made!.id, total_count: 120 });

    // The next member on the same plan: the plan is remembered, so nothing is listed or made again.
    rz.calls.length = 0;
    await startTrainerPayment((await member()).id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" });
    expect(rz.steps()).toEqual([`GET /plans/${made!.id}`, "POST /subscriptions"]);
    expect(rz.plans.size).toBe(1);
  });

  it("with test keys, uses a test plan that is already there instead of making another", async () => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_test_y");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "secret");
    const rz = fakeRazorpay("test", [
      // Same name but a different price, and the right price under another name: neither may be used.
      { id: "plan_wrongprice", period: "yearly", interval: 1, item: { name: "FITRON test ai-premium yearly", amount: 100, currency: "INR" } },
      { id: "plan_wrongname", period: "yearly", interval: 1, item: { name: "Something else", amount: 4_99_900, currency: "INR" } },
      { id: "plan_ready", period: "yearly", interval: 1, item: { name: "FITRON test ai-premium yearly", amount: 4_99_900, currency: "INR" } },
    ]);
    await startTrainerPayment((await member()).id, { plan: "ai-premium", cycle: "YEARLY", kind: "purchase" });
    expect(rz.steps()).toEqual(["GET /plans?count=100&skip=0", "GET /plans/plan_ready", "POST /subscriptions"]);
    expect(rz.calls.at(-1)!.body).toMatchObject({ plan_id: "plan_ready", total_count: 10 });
    expect(rz.plans.size).toBe(3);
  });

  it("with live keys, subscribes to the live plan id and never lists or makes plans", async () => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_live_x");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "secret");
    const rz = fakeRazorpay("live");
    await startTrainerPayment((await member()).id, { plan: "ai-pro", cycle: "YEARLY", kind: "purchase" });
    expect(rz.steps()).toEqual([`GET /plans/${RAZORPAY_PLANS["ai-pro"]!.YEARLY!.id}`, "POST /subscriptions"]);
    expect(rz.calls.at(-1)!.body).toMatchObject({ plan_id: RAZORPAY_PLANS["ai-pro"]!.YEARLY!.id });
  });

  it("a live server refuses test keys unless they are allowed on purpose, because a test payment is free", async () => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_test_z");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "secret");
    vi.stubEnv("NODE_ENV", "production");
    const rz = fakeRazorpay("test");
    const m = await member();
    await expect(startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" })).rejects.toThrow(/Payments aren't switched on yet/);
    expect(rz.calls).toHaveLength(0);

    vi.stubEnv("FITRON_ALLOW_TEST_PAYMENTS", "1");
    await expect(startTrainerPayment(m.id, { plan: "ai-pro", cycle: "MONTHLY", kind: "purchase" })).resolves.toMatchObject({ mode: "SUBSCRIPTION", keyId: "rzp_test_z" });

    // Live keys are never held back.
    vi.stubEnv("FITRON_ALLOW_TEST_PAYMENTS", "");
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_live_z");
    fakeRazorpay("live");
    await expect(startTrainerPayment(m.id, { plan: "ai-pro", cycle: "YEARLY", kind: "purchase" })).resolves.toMatchObject({ mode: "SUBSCRIPTION", keyId: "rzp_live_z" });
  });
});
