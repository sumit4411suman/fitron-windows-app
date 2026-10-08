import { describe, expect, it } from "vitest";
import { bestRecords, planMessage } from "./programs";
import { recordInput } from "@/lib/validation/frontdesk";

const workout = { name: "Push Pull Legs", days: [{ name: "Day A", exercises: [{ name: "Bench press", sets: "4 × 8" }, { name: "Row", sets: "3 × 10" }] }, { name: "Day B", exercises: [{ name: "Squat", sets: "5 × 5" }] }] };
const head = "Hi {{member_name}}, your plan from {{gym_name}}:\n\n";

describe("planMessage", () => {
  it("workout only", () => expect(planMessage({ workout, dietName: null })).toBe(`${head}Push Pull Legs\nDay A: Bench press 4 × 8, Row 3 × 10\nDay B: Squat 5 × 5`));
  it("diet only", () => expect(planMessage({ workout: null, dietName: "High protein" })).toBe(`${head}\n\nDiet: High protein`));
  it("both", () => expect(planMessage({ workout, dietName: "High protein" })).toMatch(/Squat 5 × 5\n\nDiet: High protein$/));
  it("neither", () => expect(planMessage({ workout: null, dietName: null })).toBe(head));
});

describe("bestRecords", () => {
  it("picks the heaviest per lift, ties to the latest date, ordered by lift", () => {
    const rows = [
      { lift: "Squat", weightKg: 100, reps: 5, date: "2026-01-01" },
      { lift: "Bench", weightKg: 60, reps: 5, date: "2026-01-01" },
      { lift: "Bench", weightKg: 65, reps: 1, date: "2026-02-01" },
      { lift: "Bench", weightKg: 65, reps: 3, date: "2026-03-01" },
    ];
    expect(bestRecords(rows)).toEqual([rows[3], rows[0]]);
    expect(bestRecords([])).toEqual([]);
  });
});

describe("recordInput", () => {
  const ok = { lift: "Bench", weightKg: "60", reps: "5", date: "2026-01-01" };
  it("accepts a good record and defaults reps", () => {
    expect(recordInput.parse(ok).weightKg).toBe(60);
    expect(recordInput.parse({ ...ok, reps: "" }).reps).toBe(1);
  });
  it("rejects bad values", () => {
    for (const bad of [{ weightKg: "0" }, { weightKg: "600" }, { reps: "0" }, { reps: "101" }, { date: "2999-01-01" }, { lift: " " }]) expect(recordInput.safeParse({ ...ok, ...bad }).success).toBe(false);
  });
});
