import { describe, expect, it } from "vitest";
import { byMember, cancellationRate, churnWindow, cohorts, coveredOn, renewalRate, segments, tenureMonths, type MemberFact, type MembershipFact } from "./ltv";

const ms = (memberId: string, start: string, end: string, net = 100_000, extra: Partial<MembershipFact> = {}): MembershipFact => ({ memberId, planName: "Monthly", start, end, net, type: "NEW", status: "VALID", soldOn: start, branchId: "b1", ...extra });
const today = "2026-10-19";

describe("membership facts", () => {
  it("groups valid memberships by member, oldest first", () => {
    const m = byMember([ms("a", "2026-03-01", "2026-03-31"), ms("a", "2026-01-01", "2026-01-31"), ms("b", "2026-01-01", "2026-01-31", 1, { status: "CANCELLED" })]);
    expect(m.get("a")!.map((x) => x.start)).toEqual(["2026-01-01", "2026-03-01"]);
    expect(m.has("b")).toBe(false);
  });
  it("knows whether a day is covered and how long the member has been around", () => {
    const list = [ms("a", "2026-01-01", "2026-01-31"), ms("a", "2026-02-01", "2026-12-31")];
    expect(coveredOn(list, "2026-01-15")).toBe(true);
    expect(coveredOn(list, "2027-01-01")).toBe(false);
    expect(tenureMonths(list, today)).toBe(9.6); // to today, not to the future end
    expect(tenureMonths([ms("a", "2026-01-01", "2026-01-31")], today)).toBe(1);
    expect(tenureMonths([], today)).toBeNull();
  });
});

describe("renewal rate", () => {
  it("counts a membership renewed when another starts within 30 days of its end", () => {
    const all = byMember([
      ms("a", "2026-08-01", "2026-08-31"),
      ms("a", "2026-09-05", "2026-10-04"), // renewed (gap 5 days)
      ms("b", "2026-08-01", "2026-08-31"), // not renewed
      ms("c", "2026-08-01", "2026-08-31"),
      ms("c", "2026-10-15", "2026-11-14"), // too late: a new start, not a renewal
    ]);
    expect(renewalRate(all, { from: "2026-08-01", to: "2026-08-31" }, today)).toEqual({ ended: 3, renewed: 1, rate: 33.3, pending: 0 });
  });
  it("leaves out endings whose 30-day window is still open", () => {
    const all = byMember([ms("a", "2026-09-01", "2026-10-10")]);
    expect(renewalRate(all, { from: "2026-10-01", to: "2026-10-31" }, today)).toEqual({ ended: 0, renewed: 0, rate: null, pending: 1 });
  });
});

describe("cancellation rate", () => {
  it("is cancelled over sold in the period, by sale date", () => {
    const list = [ms("a", "2026-10-01", "2026-10-31"), ms("b", "2026-10-02", "2026-11-01", 1, { status: "CANCELLED" }), ms("c", "2026-09-01", "2026-09-30")];
    expect(cancellationRate(list, { from: "2026-10-01", to: "2026-10-31" })).toEqual({ sold: 2, cancelled: 1, rate: 50 });
    expect(cancellationRate([], { from: "2026-10-01", to: "2026-10-31" }).rate).toBeNull();
  });
});

describe("cohorts", () => {
  const members: MemberFact[] = [
    { id: "a", joined: "2026-01-10", source: "Walk-in", branchId: "b1", suspended: false },
    { id: "b", joined: "2026-01-20", source: "Instagram", branchId: "b1", suspended: false },
    { id: "c", joined: "2026-09-01", source: "Walk-in", branchId: "b1", suspended: false },
    { id: "old", joined: "2024-01-01", source: "Walk-in", branchId: "b1", suspended: false },
  ];
  const all = byMember([
    ms("a", "2026-01-10", "2026-02-09", 100_000),
    ms("a", "2026-02-10", "2026-12-31", 900_000),
    ms("b", "2026-01-20", "2026-02-19", 100_000),
    ms("c", "2026-09-01", "2026-09-30", 100_000),
  ]);
  it("measures retention only at points every member of the cohort has reached", () => {
    const rows = cohorts(members, all, today, 12);
    expect(rows.map((r) => r.cohort)).toEqual(["2026-01", "2026-09"]);
    const jan = rows[0]!;
    expect(jan.members).toBe(2);
    expect(jan.retained).toEqual({ m1: 50, m3: 50, m6: 50, m12: null });
    expect(jan.revenue).toBe(1_100_000);
    expect(jan.revenuePerMember).toBe(550_000);
    const sep = rows[1]!;
    expect(sep.retained).toEqual({ m1: 0, m3: null, m6: null, m12: null });
  });
  it("segments members by any key with revenue, tenure and who is active today", () => {
    const bySource = segments(members, all, today, (m) => m.source);
    expect(bySource[0]).toMatchObject({ key: "Walk-in", members: 3, revenue: 1_100_000, active: 1 });
    expect(bySource[1]).toMatchObject({ key: "Instagram", members: 1, revenue: 100_000, active: 0 });
    expect(segments(members, all, today, () => null)).toEqual([]);
  });
  it("counts who was covered N months ago and is not covered today", () => {
    expect(churnWindow(all, today, 6)).toEqual({ start: 1, lost: 0 }); // only "a" was covered on 2026-04-19
    expect(churnWindow(all, today, 8)).toEqual({ start: 2, lost: 1 }); // a and b on 2026-02-19; b gone
  });
});
