import { describe, expect, it } from "vitest";
import { defaultPlanFor, membershipStatus } from "./membership";

const today = "2026-09-27";
const base = { suspended: false, outstanding: 0, today };

describe("membershipStatus", () => {
  it("puts suspension ahead of everything else", () => {
    expect(membershipStatus({ ...base, suspended: true, latestEnd: "2026-08-01", outstanding: 500 })).toBe(
      "SUSPENDED",
    );
  });

  it("is EXPIRED the day after the end date, or with no membership", () => {
    expect(membershipStatus({ ...base, latestEnd: "2026-09-26" })).toBe("EXPIRED");
    expect(membershipStatus({ ...base, latestEnd: null })).toBe("EXPIRED");
  });

  it("is EXPIRING_SOON from the end date back to 7 days before", () => {
    expect(membershipStatus({ ...base, latestEnd: "2026-09-27" })).toBe("EXPIRING_SOON");
    expect(membershipStatus({ ...base, latestEnd: "2026-10-04" })).toBe("EXPIRING_SOON");
    expect(membershipStatus({ ...base, latestEnd: "2026-10-05" })).toBe("ACTIVE");
  });

  it("is PAYMENT_PENDING with a balance and more than 7 days left", () => {
    expect(membershipStatus({ ...base, latestEnd: "2026-12-31", outstanding: 1 })).toBe("PAYMENT_PENDING");
  });
});

describe("defaultPlanFor", () => {
  const plans = [
    { id: "m1", months: 1, price: 150000 },
    { id: "q1", months: 3, price: 400000 },
    { id: "q2", months: 3, price: 450000 },
    { id: "y1", months: 12, price: 1200000 },
  ];
  it("picks the first plan of the default duration", () => {
    expect(defaultPlanFor(plans, 3)?.id).toBe("q1");
    expect(defaultPlanFor(plans, 12)?.id).toBe("y1");
  });
  it("picks nothing when no plan has that duration, so the form keeps its first plan", () => {
    expect(defaultPlanFor(plans, 6)).toBeUndefined();
    expect(defaultPlanFor([], 1)).toBeUndefined();
  });
});
