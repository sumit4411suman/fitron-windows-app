import { describe, expect, it } from "vitest";
import { accessInput, formatWorkoutDays, parseMeals, parseWorkoutDays, progressInput } from "./frontdesk";

describe("workout text", () => {
  it("parses days and exercises, and round-trips", () => {
    const text = "Day A\n- Goblet squat | 3 × 12\nPlank | 3 × 30 s\n\nDay B\nLeg press | 3 × 12";
    const days = parseWorkoutDays(text);
    expect(days).toEqual([
      { name: "Day A", exercises: [{ name: "Goblet squat", sets: "3 × 12" }, { name: "Plank", sets: "3 × 30 s" }] },
      { name: "Day B", exercises: [{ name: "Leg press", sets: "3 × 12" }] },
    ]);
    expect(parseWorkoutDays(formatWorkoutDays(days))).toEqual(days);
  });
  it("puts exercises before any heading under Day 1 and drops empty days", () => {
    expect(parseWorkoutDays("Squat | 5 × 5\nEmpty day")).toEqual([{ name: "Day 1", exercises: [{ name: "Squat", sets: "5 × 5" }] }]);
  });
});

describe("meals and progress", () => {
  it("parses meals", () => expect(parseMeals("Breakfast | Poha | peanuts\nnoise")).toEqual([{ name: "Breakfast", food: "Poha | peanuts" }]));
  it("needs at least one measurement", () => {
    expect(progressInput.safeParse({ date: "2026-09-28", weightKg: "", bodyFat: "", waistCm: "" }).success).toBe(false);
    expect(progressInput.safeParse({ date: "2026-09-28", weightKg: "72.5" }).data?.weightKg).toBe(72.5);
  });
});

describe("accessInput", () => {
  const base = { graceDays: "2", duesLimit: "0" };
  it("reads the anti-passback checkbox", () => {
    expect(accessInput.parse({ ...base, antiPassback: "on" }).antiPassback).toBe(true);
    expect(accessInput.parse(base).antiPassback).toBe(false);
  });
  it("rejects grace days over 60", () => expect(accessInput.safeParse({ ...base, graceDays: "61" }).success).toBe(false));
});
