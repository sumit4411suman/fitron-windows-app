import { describe, expect, it } from "vitest";
import { normaliseCode, offerDiscount, offerState, offerUsable } from "./offers";

const base = { type: "PERCENT", value: 10, validTill: "2026-10-31", usageLimit: null, uses: 0, status: "ACTIVE" };

describe("offers", () => {
  it("discounts by percent or a flat amount, never past the price", () => {
    expect(offerDiscount(base, 150000)).toBe(15000);
    expect(offerDiscount({ type: "FLAT", value: 50000 }, 150000)).toBe(50000);
    expect(offerDiscount({ type: "FLAT", value: 500000 }, 150000)).toBe(150000);
  });

  it("can only be used while active, in date and under its limit", () => {
    expect(offerUsable(base, "2026-10-31")).toBe(true);
    expect(offerState(base, "2026-11-01")).toBe("Expired");
    expect(offerState({ ...base, status: "PAUSED" }, "2026-10-02")).toBe("Paused");
    expect(offerState({ ...base, usageLimit: 5, uses: 5 }, "2026-10-02")).toBe("Used up");
  });

  it("normalises codes", () => expect(normaliseCode(" diwali 25 ")).toBe("DIWALI25"));
});
