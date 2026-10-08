import { describe, expect, it } from "vitest";
import { riskBand, riskScore } from "./risk";

describe("member risk score", () => {
  it("a regular, paid-up member with months left is low risk", () => {
    const r = riskScore({ daysSinceVisit: 1, visits30: 14, visitsPrev30: 13, daysToExpiry: 60, outstanding: 0 });
    expect(r.score).toBe(0);
    expect(riskBand(r.score)).toBe("Low");
  });

  it("stopped coming, visits halved, expiring soon and owing money is high risk, with reasons", () => {
    const r = riskScore({ daysSinceVisit: 24, visits30: 1, visitsPrev30: 10, daysToExpiry: 5, outstanding: 300_000 });
    expect(r.score).toBe(95);
    expect(riskBand(r.score)).toBe("High");
    expect(r.reasons).toEqual(["Last visit 24 days ago", "Visits down from 10 to 1 a month", "Expires in 5 days", "Dues of ₹2,000 or more"]);
  });

  it("caps at 100 and treats long-expired members as gone rather than at risk", () => {
    expect(riskScore({ daysSinceVisit: null, visits30: 0, visitsPrev30: 8, daysToExpiry: -3, outstanding: 900_000 }).score).toBe(90);
    expect(riskScore({ daysSinceVisit: 90, visits30: 0, visitsPrev30: 0, daysToExpiry: -80, outstanding: 0 }).score).toBe(40);
  });
});
