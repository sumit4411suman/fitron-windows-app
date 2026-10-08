import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import webpush from "web-push";
import { hasDb } from "@/test/db";
import { db } from "@/lib/db";
import { deleteTrainerAccount, findOrCreateTrainer, saveTrainerState } from "./trainer";
import { pushPublicKey, pushReady, removePush, savePush, sendTrainerReminders } from "./trainer-push";

const email = () => `p-${randomUUID().slice(0, 8)}@test.local`;
// A push service nothing listens on: every send fails fast, which is what the failure path needs.
const sub = (n: number) => ({ endpoint: `https://127.0.0.1:9/push/${randomUUID()}/${n}`, keys: { p256dh: "BPUBLIC".padEnd(87, "A"), auth: "AUTHAUTHAUTHAUTHAUTHAU" } });

describe.skipIf(!hasDb)("AI Trainer push reminders (database)", () => {
  const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
  beforeAll(() => {
    const k = webpush.generateVAPIDKeys();
    process.env.VAPID_PUBLIC_KEY = k.publicKey;
    process.env.VAPID_PRIVATE_KEY = k.privateKey;
  });
  afterAll(() => {
    process.env.VAPID_PUBLIC_KEY = saved.pub;
    process.env.VAPID_PRIVATE_KEY = saved.priv;
  });

  it("keeps a device's subscription, once per endpoint, and drops it on sign-out", async () => {
    expect(pushReady()).toBe(true);
    expect(pushPublicKey()).toBe(process.env.VAPID_PUBLIC_KEY);
    const m = await findOrCreateTrainer(email(), "EMAIL");
    const s = sub(1);
    const p = await savePush(m.id, s, "Test phone");
    expect((await savePush(m.id, s)).id).toBe(p.id);
    // The same phone signing into another account follows the newest sign-in.
    const other = await findOrCreateTrainer(email(), "EMAIL");
    expect((await savePush(other.id, s)).memberId).toBe(other.id);
    expect(await db.trainerPush.count({ where: { memberId: m.id } })).toBe(0);
    await expect(savePush(m.id, { endpoint: "http://not-https", keys: { p256dh: "x", auth: "y" } })).rejects.toThrow(/isn't valid/);
    await expect(savePush(m.id, {})).rejects.toThrow(/isn't valid/);
    await removePush(other.id, s.endpoint);
    expect(await db.trainerPush.count({ where: { endpoint: s.endpoint } })).toBe(0);
    // Deleting the account removes its devices.
    await savePush(other.id, sub(2));
    await deleteTrainerAccount(other.id);
    expect(await db.trainerPush.count({ where: { memberId: other.id } })).toBe(0);
  });

  it("sends what is due to onboarded members and counts a device's failures", async () => {
    const m = await findOrCreateTrainer(email(), "EMAIL", "Asha");
    await saveTrainerState(m.id, { profile: { ob: { name: "Asha", water: "3", referral: "none" }, plan: { Mon: "Chest", Tue: "Chest", Wed: "Chest", Thu: "Chest", Fri: "Chest", Sat: "Chest", Sun: "Chest" }, reminders: { workout: true, water: true }, notificationsOn: true }, onboarded: true });
    const s = sub(3);
    await savePush(m.id, s);
    // Not onboarded yet: nothing goes to this one.
    const fresh = await findOrCreateTrainer(email(), "EMAIL");
    await savePush(fresh.id, sub(4));

    // 07:00 India time: the morning brief is due; the push service is unreachable, so it fails and is counted.
    const sevenIst = new Date("2026-10-05T01:30:00Z");
    // (The shared test database may hold devices from earlier runs, so counts are lower bounds.)
    const r = await sendTrainerReminders(sevenIst);
    expect(r.ready).toBe(true);
    expect(r.devices).toBeGreaterThanOrEqual(1);
    expect(r.sent).toBe(0);
    const p = await db.trainerPush.findUniqueOrThrow({ where: { endpoint: s.endpoint } });
    expect(p.failures).toBe(1);
    expect(p.sent).toEqual({});
    expect(await db.trainerPush.count({ where: { memberId: fresh.id, failures: 0 } })).toBe(1);
    // Nothing due at 3 AM.
    expect((await sendTrainerReminders(new Date("2026-10-04T21:30:00Z"))).sent).toBe(0);
    expect((await db.trainerPush.findUniqueOrThrow({ where: { endpoint: s.endpoint } })).failures).toBe(1);

    // Without keys the job does nothing.
    const pub = process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    expect(await sendTrainerReminders()).toEqual({ ready: false, devices: 0, sent: 0, removed: 0 });
    process.env.VAPID_PUBLIC_KEY = pub;
  });
});
