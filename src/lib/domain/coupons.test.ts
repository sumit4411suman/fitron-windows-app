import { describe, expect, it } from "vitest";
import { applyCoupon, couponLabel, couponCovers, couponState, MIN_CHARGE, normaliseCode } from "./coupons";

const base = { appliesTo: "ALL", validTill: "2026-10-31", usageLimit: null, status: "ACTIVE" };

describe("coupons", () => {
  it("takes the percentage off the listed price", () => {
    expect(applyCoupon(1_99_900, 99)).toEqual({ discount: 1_97_901, total: 1_999 });
    expect(applyCoupon(29_900, 10)).toEqual({ discount: 2_990, total: 26_910 });
    // The discount and what is charged always add up to the listed price.
    for (const pct of [1, 7, 33, 50, 99]) {
      const r = applyCoupon(4_99_000, pct);
      expect(r.discount + r.total).toBe(4_99_000);
    }
  });

  it("makes a 100% coupon free, and never charges less than Razorpay's minimum otherwise", () => {
    expect(applyCoupon(99_900, 100)).toEqual({ discount: 99_900, total: 0 });
    expect(applyCoupon(120, 99)).toEqual({ discount: 20, total: MIN_CHARGE });
    expect(applyCoupon(50, 99).total).toBe(50);
  });

  it("clamps silly percentages", () => {
    expect(applyCoupon(1000, 150)).toEqual({ discount: 1000, total: 0 });
    expect(applyCoupon(1000, -5)).toEqual({ discount: 0, total: 1000 });
  });

  it("works while active, in date and under its limit", () => {
    expect(couponState(base, 0, "2026-10-31")).toBe("Active");
    expect(couponState({ ...base, validTill: null }, 0, "2030-01-01")).toBe("Active");
    expect(couponState(base, 0, "2026-11-01")).toBe("Expired");
    expect(couponState({ ...base, status: "PAUSED" }, 0, "2026-10-02")).toBe("Paused");
    expect(couponState({ ...base, usageLimit: 5 }, 4, "2026-10-02")).toBe("Active");
    expect(couponState({ ...base, usageLimit: 5 }, 5, "2026-10-02")).toBe("Used up");
  });

  it("covers the product it was made for", () => {
    expect(couponCovers("ALL", "GYM")).toBe(true);
    expect(couponCovers("ALL", "TRAINER")).toBe(true);
    expect(couponCovers("GYM", "GYM")).toBe(true);
    expect(couponCovers("GYM", "TRAINER")).toBe(false);
    expect(couponCovers("TRAINER", "GYM")).toBe(false);
  });

  it("normalises codes", () => expect(normaliseCode(" welcome 99 ")).toBe("WELCOME99"));

  it("a flat-price coupon charges that amount whatever the price, never above the price or below ₹1", () => {
    expect(applyCoupon(3_99_900, 99, 100)).toEqual({ discount: 3_99_800, total: 100 });
    expect(applyCoupon(29_900, 99, 100)).toEqual({ discount: 29_800, total: 100 });
    expect(applyCoupon(50, 99, 100)).toEqual({ discount: 0, total: 50 });
    expect(applyCoupon(3_99_900, 99, 10).total).toBe(MIN_CHARGE);
    expect(applyCoupon(5_000, 99, 9_00_000).total).toBe(5_000);
    expect(couponLabel(99, 100)).toBe("price set to ₹1");
    expect(couponLabel(99, null)).toBe("99% off");
  });
});
