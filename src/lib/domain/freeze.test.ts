import { describe, expect, it } from "vitest";
import { freezeCovers, freezeLastDay, freezeOpen, freezeScheduled, unusedFreezeDays } from "./freeze";

const f = { fromDate: "2026-10-05", days: 10, endedOn: null };

describe("membership freeze", () => {
  it("covers its days and gives back unused ones", () => {
    expect(freezeLastDay(f)).toBe("2026-10-14");
    expect(freezeCovers(f, "2026-10-04")).toBe(false);
    expect(freezeOpen(f, "2026-10-04")).toBe(true);
    expect(freezeCovers(f, "2026-10-14")).toBe(true);
    expect(freezeOpen(f, "2026-10-15")).toBe(false);
    expect(unusedFreezeDays(f, "2026-10-02")).toBe(10);
    expect(unusedFreezeDays(f, "2026-10-08")).toBe(7);
    expect(unusedFreezeDays(f, "2026-10-20")).toBe(0);
    expect(freezeCovers({ ...f, endedOn: "2026-10-07" }, "2026-10-08")).toBe(false);
  });
  it("is scheduled, not frozen, before its start date", () => {
    expect(freezeScheduled(f, "2026-10-04")).toBe(true);
    expect(freezeScheduled(f, "2026-10-05")).toBe(false);
    expect(freezeScheduled(f, "2026-10-15")).toBe(false);
    expect(freezeScheduled({ ...f, endedOn: "2026-10-03" }, "2026-10-04")).toBe(false);
  });
});
