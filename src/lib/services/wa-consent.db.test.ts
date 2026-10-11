import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { isLocal } from "@/lib/runtime/edition";
import { createMember } from "./members";
import { putSetting } from "./settings";
import { deliverMessage, prepareMessage, sendTemplate } from "./whatsapp";
import { runLocalDailyJobs } from "./jobs";
import { todayIso } from "./time";
import { createPlan } from "./plans";
import { createMandate } from "./autopay";

// Phase 12 on FITRON for Windows as shipped: linking WhatsApp sends nothing on its own. Messages nobody pressed send for
// go out only once a gym user turned on "Send automatic messages", and a message saved while WhatsApp was not linked is
// never sent later. (The Cloud Edition goes by each template's Auto-send, unchanged.)

beforeEach(() => {
  vi.stubEnv("FITRON_LOCAL_ALLOW_SIGNUP", "");
  // A linked phone whose connector is not running: anything that tried to send would fail at once, never leave.
  vi.stubEnv("WA_CONNECTOR_URL", "http://127.0.0.1:9");
});
afterEach(() => vi.unstubAllEnvs());

describe.skipIf(!hasDb || !isLocal())("WhatsApp sends only what the gym chose (FITRON for Windows)", () => {
  const setUp = async () => {
    const g = await makeGym();
    const owner = pick(await g.user("Super Admin"), g.a.id);
    const m = await createMember(owner, { name: "Ravi Kumar", gender: "Male", phone: "9866630001", source: "Walk-in", tags: [] });
    return { g, owner, m };
  };

  it("links WhatsApp without sending automatic messages until they are switched on", async () => {
    const { g, owner, m } = await setUp();
    await putSetting(owner, "whatsapp", { mode: "connector" });
    expect(await sendTemplate({ orgId: g.org.id, memberId: m.id, key: "welcome", auto: true })).toBeNull();
    expect(await db.whatsAppMessage.count({ where: { orgId: g.org.id } })).toBe(0);
    // A message staff send with a button still goes (or is tried): pressing send is the choice.
    expect(await sendTemplate({ orgId: g.org.id, memberId: m.id, key: "welcome", force: true })).toMatchObject({ status: "Failed" });
    await putSetting(owner, "whatsapp", { automatic: true });
    expect(await sendTemplate({ orgId: g.org.id, memberId: m.id, key: "welcome", auto: true, force: true })).not.toBeNull();
  });

  it("keeps the daily reminders off while automatic messages are off", async () => {
    const { g, owner } = await setUp();
    await putSetting(owner, "whatsapp", { mode: "connector" });
    const out = await runLocalDailyJobs(g.org.id, todayIso());
    for (const name of ["reminders.expiry", "reminders.dues", "reminders.birthday", "reminders.winback", "reminders.autopay"]) expect(out.find((j) => j.name === name), name).toMatchObject({ status: "ran", result: { note: "automatic messages are off: nothing sent" } });
  });

  it("never sends later a message saved while WhatsApp was not linked", async () => {
    const { g, owner, m } = await setUp();
    const held = await prepareMessage({ orgId: g.org.id, memberId: m.id, key: "welcome", force: true, holdUntil: new Date(Date.now() - 60_000) });
    expect(held).toMatchObject({ provider: "demo", status: "Scheduled" });
    await putSetting(owner, "whatsapp", { mode: "connector", automatic: true });
    expect(await deliverMessage(held!.id)).toMatchObject({ status: "Logged" });
  });

  it("tells no member about a demo autopay: its debits are simulated", async () => {
    const { g, owner, m } = await setUp();
    await putSetting(owner, "whatsapp", { mode: "connector", automatic: true });
    const plan = await createPlan(owner, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    expect(await createMandate(owner, { memberId: m.id, planId: plan.id })).toMatchObject({ mode: "demo" });
    expect(await db.whatsAppMessage.count({ where: { orgId: g.org.id } })).toBe(0);
  });
});

