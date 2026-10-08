import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasDb, makeGym } from "@/test/db";
import { db } from "@/lib/db";
import { PARTNER_SHARE } from "@/lib/domain/pricing";
import { deleteTrainerAccount, findOrCreateTrainer, loadTrainer, saveTrainerState } from "./trainer";
import { ensureTrainerCode, gymView, linkTrainerGym, normaliseCode, partnership, trainerStatusFor, unlinkTrainerGym } from "./trainer-gym";
import { todayIso } from "./time";

const email = () => `g-${randomUUID().slice(0, 8)}@test.local`;

describe("trainer codes", () => {
  it("normalises what members type", () => {
    expect(normaliseCode(" ab-c d2 ")).toBe("ABCD2");
    expect(normaliseCode("")).toBe("");
  });
});

describe.skipIf(!hasDb)("Gym Partnership (database)", () => {
  it("a gym gets one code, and members link by code with their record matched by email or phone", async () => {
    const g = await makeGym();
    const owner = await g.user("Super Admin");
    const code = await ensureTrainerCode(g.org.id);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(await ensureTrainerCode(g.org.id)).toBe(code);

    const byEmail = email();
    const asha = await db.member.create({ data: { orgId: g.org.id, branchId: g.a.id, code: "T-1", name: "Asha", gender: "F", phone: "9876543210", email: byEmail.toUpperCase(), source: "Walk-in", createdById: owner.id } });
    const ravi = await db.member.create({ data: { orgId: g.org.id, branchId: g.a.id, code: "T-2", name: "Ravi", gender: "M", phone: "9123456789", source: "Walk-in", createdById: owner.id } });

    // Matched by the sign-in email, whatever its case at the gym.
    const t1 = await findOrCreateTrainer(byEmail, "EMAIL", "Asha");
    const v1 = await linkTrainerGym(t1.id, ` ${code.toLowerCase()} `);
    expect(v1.member).toEqual({ code: "T-1", name: "Asha" });
    expect(v1.code).toBe(code);

    // Matched by the phone given to the app, with +91 and spaces.
    const t2 = await findOrCreateTrainer(email(), "GOOGLE", "Ravi");
    await saveTrainerState(t2.id, { profile: { ob: { name: "Ravi", phone: "+91 91234 56789" } } });
    const v2 = await linkTrainerGym(t2.id, code);
    expect(v2.member?.code).toBe("T-2");
    // The link wrote the gym's name into the profile, so the app shows it.
    const d2 = await loadTrainer(t2.id);
    expect((d2.profile.ob as { gymName: string }).gymName).toBe(g.org.name);
    expect(d2.gym?.member?.name).toBe("Ravi");

    // No match: linked to the gym alone.
    const t3 = await findOrCreateTrainer(email(), "EMAIL", "Nobody");
    const v3 = await linkTrainerGym(t3.id, code);
    expect(v3.member).toBeNull();

    // A record already linked to another account is not linked twice.
    const t4 = await findOrCreateTrainer(byEmail.replace("@", "+2@"), "EMAIL", "Asha again");
    await saveTrainerState(t4.id, { profile: { ob: { phone: "9876543210" } } });
    expect((await linkTrainerGym(t4.id, code)).member).toBeNull();

    await expect(linkTrainerGym(t1.id, "NOPE99")).rejects.toThrow(/No gym has this code/);
    await expect(linkTrainerGym(t1.id, "")).rejects.toThrow(/Type the code/);

    // The gym's side.
    const s = await trainerStatusFor(owner, asha.id);
    expect(s?.email).toBe(byEmail);
    expect(s?.access).toBe("LOCKED");
    expect(await trainerStatusFor(owner, ravi.id)).not.toBeNull();

    // Leaving, and deleting the account, both clear the link.
    await unlinkTrainerGym(t3.id);
    expect(await gymView(await db.trainerMember.findUniqueOrThrow({ where: { id: t3.id } }))).toBeNull();
    await deleteTrainerAccount(t2.id);
    expect(await trainerStatusFor(owner, ravi.id)).toBeNull();
  });

  it("a new member must say whether a gym referred them, and a gym referral needs the gym's code", async () => {
    const g = await makeGym();
    const code = await ensureTrainerCode(g.org.id);
    const m = await findOrCreateTrainer(email(), "EMAIL", "Kabir");
    const fresh = async () => (await db.trainerMember.findUniqueOrThrow({ where: { id: m.id } })).onboardedAt;

    // No answer yet.
    await expect(saveTrainerState(m.id, { profile: { ob: { name: "Kabir" } }, onboarded: true })).rejects.toThrow(/whether a partner gym referred you/);
    expect(await fresh()).toBeNull();
    // Says a gym referred them, but has not entered its code.
    await expect(saveTrainerState(m.id, { profile: { ob: { name: "Kabir", referral: "gym" } }, onboarded: true })).rejects.toThrow(/code your gym gave you/);
    expect(await fresh()).toBeNull();
    // With the code entered the referral stands, and the member is linked to that gym.
    await linkTrainerGym(m.id, code);
    await saveTrainerState(m.id, { profile: { ob: { name: "Kabir", referral: "gym" } }, onboarded: true });
    expect(await fresh()).not.toBeNull();
    expect((await loadTrainer(m.id)).gym?.name).toBe(g.org.name);

    // Not referred: that is an answer too. Edits after onboarding are not asked again.
    const n = await findOrCreateTrainer(email(), "GOOGLE", "Nina");
    await saveTrainerState(n.id, { profile: { ob: { name: "Nina", referral: "none" } }, onboarded: true });
    expect((await db.trainerMember.findUniqueOrThrow({ where: { id: n.id } })).onboardedAt).not.toBeNull();
    await expect(saveTrainerState(n.id, { profile: { ob: { name: "Nina" } }, onboarded: true })).resolves.toBeUndefined();
  });

  it("the partnership page counts the gym's share of payments confirmed in a month", async () => {
    const g = await makeGym();
    const owner = await g.user("Super Admin");
    const code = await ensureTrainerCode(g.org.id);
    const t = await findOrCreateTrainer(email(), "EMAIL", "Meera");
    await linkTrainerGym(t.id, code);
    const other = await findOrCreateTrainer(email(), "EMAIL", "Elsewhere");

    const month = todayIso().slice(0, 7);
    const paid = (memberId: string, base: number, paidAt: Date, status = "PAID") =>
      db.trainerPayment.create({ data: { memberId, plan: "ai-pro", cycle: "MONTHLY", kind: "purchase", base, gst: Math.round(base * 0.18), total: Math.round(base * 1.18), mode: "SUBSCRIPTION", status, paidAt } });
    await paid(t.id, 29_900, new Date());
    await paid(t.id, 49_900, new Date());
    await paid(t.id, 1_99_900, new Date(Date.now() - 40 * 86_400_000)); // last month
    await paid(t.id, 29_900, new Date(), "PENDING"); // not paid yet
    await paid(other.id, 29_900, new Date()); // not this gym's member

    const p = await partnership(owner, month);
    expect(p.totals.members).toBe(1);
    expect(p.totals.base).toBe(79_800);
    expect(p.totals.share).toBe(Math.round(79_800 * PARTNER_SHARE));
    expect(p.paid.map((x) => x.share)).toEqual([Math.round(29_900 * PARTNER_SHARE), Math.round(49_900 * PARTNER_SHARE)]);
    expect(p.rows[0]?.name).toBe("Meera");
    expect(p.rows[0]?.gymMember).toBeNull();
  });
});
