import { describe, expect, it } from "vitest";
import { findPlan, type Cycle } from "./pricing";
import { BRANCH_PLAN_KEY, RAZORPAY_PLANS, razorpayPlan, SUBSCRIPTION_CHARGES } from "./razorpay-plans";
import { BRANCH_PRICE } from "./saas";
import { findService, MAX_SERVICE_RUPEES, SERVICES, servicePaise } from "./services";

describe("FITRON's Razorpay plans", () => {
  const entries = Object.entries(RAZORPAY_PLANS).flatMap(([key, cycles]) => Object.entries(cycles).map(([cycle, p]) => ({ key, cycle: cycle as Cycle, ...p! })));

  it("has the 14 plans made in the Razorpay account, with their own ids", () => {
    expect(entries).toHaveLength(14);
    expect(new Set(entries.map((e) => e.id)).size).toBe(14);
    for (const e of entries) expect(e.id, `${e.key} ${e.cycle}`).toMatch(/^plan_[A-Za-z0-9]{10,}$/);
  });

  it("charges exactly what the price list says, because a Razorpay plan's amount can't be changed from here", () => {
    for (const e of entries) {
      const listed = e.key === BRANCH_PLAN_KEY ? BRANCH_PRICE[e.cycle] : findPlan(e.key)?.price[e.cycle];
      expect(listed, `${e.key} is in the price list`).toBeDefined();
      expect(e.amount, `${e.key} ${e.cycle}`).toBe(listed);
    }
  });

  it("covers every AI Trainer and Gym Accounting plan both ways, partner plans and the extra branch monthly", () => {
    for (const k of ["ai-pro", "ai-premium", "starter", "professional", "enterprise"]) for (const c of ["MONTHLY", "YEARLY"]) expect(razorpayPlan(k, c), `${k} ${c}`).not.toBeNull();
    for (const k of ["partner-referral", "partner-software", "partner-enterprise", BRANCH_PLAN_KEY]) {
      expect(razorpayPlan(k, "MONTHLY"), k).not.toBeNull();
      // No yearly Razorpay plan exists for these: they are paid once instead.
      expect(razorpayPlan(k, "YEARLY"), k).toBeNull();
    }
    expect(razorpayPlan("nope", "MONTHLY")).toBeNull();
    expect(razorpayPlan(null, "MONTHLY")).toBeNull();
  });

  it("stops charging after ten years", () => {
    expect(SUBSCRIPTION_CHARGES).toEqual({ MONTHLY: 120, YEARLY: 10 });
  });
});

describe("one-time add-ons", () => {
  it("lists the five add-ons from the pricing page at their starting prices", () => {
    expect(SERVICES.map((s) => [s.key, s.price, s.quoted])).toEqual([
      ["onboarding", 99_900, false],
      ["branding", 4_99_900, false],
      ["data-migration", 99_900, true],
      ["integration", 99_900, true],
      ["mobile-app", 9_99_900, true],
    ]);
    expect(findService("onboarding")?.name).toBe("Gym onboarding and setup");
    expect(findService("nope")).toBeUndefined();
  });

  it("charges a fixed add-on its price whatever amount is sent, and a quoted one the agreed amount", () => {
    const fixed = findService("onboarding")!;
    const quoted = findService("mobile-app")!;
    expect(servicePaise(fixed)).toBe(99_900);
    expect(servicePaise(fixed, 1)).toBe(99_900);
    expect(servicePaise(quoted)).toBe(9_99_900);
    expect(servicePaise(quoted, 15_000)).toBe(15_00_000);
  });

  it("refuses a quoted amount that is below the starting price, not in whole rupees, or more than one payment may be", () => {
    const quoted = findService("data-migration")!;
    expect(() => servicePaise(quoted, 998)).toThrow(/starts at ₹999/);
    expect(() => servicePaise(quoted, 0)).toThrow(/whole rupees/);
    expect(() => servicePaise(quoted, 1500.5)).toThrow(/whole rupees/);
    expect(() => servicePaise(quoted, Number.NaN)).toThrow(/whole rupees/);
    expect(servicePaise(quoted, MAX_SERVICE_RUPEES)).toBe(MAX_SERVICE_RUPEES * 100);
    expect(() => servicePaise(quoted, MAX_SERVICE_RUPEES + 1)).toThrow(/most one payment/);
  });
});
