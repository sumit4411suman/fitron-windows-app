import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasDb, makeGym } from "@/test/db";
import { db } from "@/lib/db";
import { PARTNER_SHARE } from "@/lib/domain/pricing";
import { findOrCreateTrainer, saveTrainerState, startTrainerTrial } from "./trainer";
import { partnerPayouts, trainerMembers, trainerOverview, trainerPaymentList } from "./trainer-admin";
import { ensureTrainerCode, linkTrainerGym } from "./trainer-gym";
import { fromIso, todayIso } from "./time";

const email = () => `a-${randomUUID().slice(0, 8)}@test.local`;

describe.skipIf(!hasDb)("AI Trainer admin (database)", () => {
  it("lists members by state and search, and sums what they paid", async () => {
    const today = todayIso();
    const tag = randomUUID().slice(0, 6);
    const paying = await findOrCreateTrainer(email(), "GOOGLE", `Paying ${tag}`);
    await db.trainerMember.update({ where: { id: paying.id }, data: { paidUntil: fromIso(today), onboardedAt: new Date() } });
    await db.trainerPayment.create({ data: { memberId: paying.id, plan: "ai-pro", cycle: "MONTHLY", kind: "purchase", base: 29_900, gst: 5_382, total: 35_282, mode: "SUBSCRIPTION", status: "PAID", paidAt: new Date() } });
    const trial = await findOrCreateTrainer(email(), "EMAIL", `Trial ${tag}`);
    await saveTrainerState(trial.id, { profile: { ob: { referral: "none" } }, onboarded: true });
    await startTrainerTrial(trial.id);
    const locked = await findOrCreateTrainer(email(), "EMAIL", `Locked ${tag}`);
    await saveTrainerState(locked.id, { profile: { ob: { referral: "none" } }, onboarded: true });

    const all = await trainerMembers({ q: tag }, today);
    expect(all.total).toBe(3);
    const byName = Object.fromEntries(all.rows.map((r) => [r.name.split(" ")[0], r]));
    expect(byName.Paying).toMatchObject({ access: "ACTIVE", lifetime: 35_282, signupVia: "GOOGLE", paidUntil: today });
    expect(byName.Trial?.access).toBe("TRIAL");
    expect(byName.Locked).toMatchObject({ access: "LOCKED", lifetime: 0 });
    expect((await trainerMembers({ q: tag, status: "active" }, today)).rows.map((r) => r.id)).toEqual([paying.id]);
    expect((await trainerMembers({ q: tag, status: "trial" }, today)).rows.map((r) => r.id)).toEqual([trial.id]);
    expect((await trainerMembers({ q: tag, status: "locked" }, today)).rows.map((r) => r.id)).toEqual([locked.id]);
    expect((await trainerMembers({ q: paying.email }, today)).total).toBe(1);

    const o = await trainerOverview(today);
    expect(o.total).toBeGreaterThanOrEqual(3);
    expect(o.active).toBeGreaterThanOrEqual(1);
    expect(o.thisMonth.total).toBeGreaterThanOrEqual(35_282);

    const pays = await trainerPaymentList({ status: "PAID", pageSize: 500 });
    expect(pays.rows.find((p) => p.email === paying.email)).toMatchObject({ total: 35_282, status: "PAID", what: "AI Pro, monthly" });
  });

  it("works out each gym's payout for a month", async () => {
    const g = await makeGym();
    const code = await ensureTrainerCode(g.org.id);
    const m = await findOrCreateTrainer(email(), "EMAIL", "Linked");
    await linkTrainerGym(m.id, code);
    const now = new Date();
    await db.trainerPayment.create({ data: { memberId: m.id, plan: "ai-premium", cycle: "MONTHLY", kind: "purchase", base: 49_900, gst: 8_982, total: 58_882, mode: "SUBSCRIPTION", status: "PAID", paidAt: now } });
    await db.trainerPayment.create({ data: { memberId: m.id, plan: "ai-premium", cycle: "MONTHLY", kind: "renew", base: 49_900, gst: 8_982, total: 58_882, mode: "SUBSCRIPTION", status: "PENDING" } });
    const p = await partnerPayouts(todayIso().slice(0, 7));
    const row = p.rows.find((r) => r.id === g.org.id);
    expect(row).toMatchObject({ gym: g.org.name, code, members: 1, payments: 1, base: 49_900, share: Math.round(49_900 * PARTNER_SHARE) });
    expect(p.totals.share).toBeGreaterThanOrEqual(row!.share);
    // A gym with linked members but no payments this month is still listed, at zero.
    const g2 = await makeGym();
    const m2 = await findOrCreateTrainer(email(), "EMAIL", "Quiet");
    await linkTrainerGym(m2.id, await ensureTrainerCode(g2.org.id));
    expect((await partnerPayouts("2020-01")).rows.find((r) => r.id === g2.org.id)).toMatchObject({ members: 1, payments: 0, share: 0 });
  });
});
