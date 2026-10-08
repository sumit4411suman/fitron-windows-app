import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { createOffer, setOfferStatus } from "./offers";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("offer codes (database)", () => {
  it("adds the offer's discount to a sale, counts the use, and refuses paused, expired or used-up codes", async () => {
    const gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const today = todayIso();
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const offer = await createOffer(admin, { code: "DIWALI10", description: "Festival", type: "PERCENT", value: 10, validTill: addDays(today, 5), usageLimit: 1 });
    await expect(createOffer(admin, { code: "DIWALI10", description: "", type: "FLAT", value: 100, validTill: today, usageLimit: null })).rejects.toThrow(/already exists/);
    const m1 = await createMember(admin, { name: "Uses Code", gender: "Male", phone: "9876544001", source: "Walk-in", tags: [] });
    const m2 = await createMember(admin, { name: "Too Late", gender: "Male", phone: "9876544002", source: "Walk-in", tags: [] });
    const sale = { planId: plan.id, startDate: today, discount: 5000, includeRegFee: false, payAmount: 0 };

    const r = await sellMembership(admin, m1.id, { ...sale, offerCode: " diwali10 " });
    expect(r.membership).toMatchObject({ discount: 20000, offerCode: "DIWALI10" });
    expect(r.invoice.total).toBe(130000);
    expect((await db.offer.findUniqueOrThrow({ where: { id: offer.id } })).uses).toBe(1);

    await expect(sellMembership(admin, m2.id, { ...sale, offerCode: "DIWALI10" })).rejects.toThrow(/not valid/);
    await db.offer.update({ where: { id: offer.id }, data: { usageLimit: null } });
    await setOfferStatus(admin, offer.id, "PAUSED");
    await expect(sellMembership(admin, m2.id, { ...sale, offerCode: "DIWALI10" })).rejects.toThrow(/not valid/);
    await expect(sellMembership(admin, m2.id, { ...sale, offerCode: "NOPE" })).rejects.toThrow(/not valid/);
  });

  it("charges the category price when one is picked, and remembers the category", async () => {
    const gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [], studentPrice: 120000 });
    const m = await createMember(admin, { name: "Student One", gender: "Male", phone: "9876544101", source: "Walk-in", tags: [] });
    await expect(sellMembership(admin, m.id, { planId: plan.id, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 0, pricingCategory: "Female" })).rejects.toThrow(/no Female price/);
    const r = await sellMembership(admin, m.id, { planId: plan.id, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 0, pricingCategory: "Student" });
    expect(r.membership).toMatchObject({ price: 120000, pricingCategory: "Student" });
    expect(r.invoice.total).toBe(120000);
  });
});
