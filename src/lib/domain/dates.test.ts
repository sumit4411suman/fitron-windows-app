import { describe, expect, it } from "vitest";
import { addDays, addMonths, ageOn, daysBetween, membershipEndDate } from "./dates";

describe("dates", () => {
  it("counts age by the calendar, so a member is a year older on the birthday itself", () => {
    expect(ageOn("1989-10-10", "2026-10-10")).toBe(37);
    expect(ageOn("1989-10-10", "2026-10-09")).toBe(36);
    expect(ageOn("1989-10-10", "2026-10-11")).toBe(37);
    expect(ageOn("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageOn("2000-02-29", "2026-03-01")).toBe(26);
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("clamps addMonths to the end of shorter months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-08-15", 12)).toBe("2027-08-15");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-10-05", "2026-09-27")).toBe(8);
    expect(daysBetween("2026-09-27", "2026-10-05")).toBe(-8);
  });

  it("ends a membership the day before the same date N months later", () => {
    expect(membershipEndDate("2026-09-01", 1)).toBe("2026-09-30");
    expect(membershipEndDate("2026-09-15", 3)).toBe("2026-12-14");
    expect(membershipEndDate("2026-01-31", 1)).toBe("2026-02-27");
  });
});
