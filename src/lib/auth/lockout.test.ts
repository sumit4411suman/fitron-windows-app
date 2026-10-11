import { describe, expect, it } from "vitest";
import { MAX_FAILURES, WINDOW_MS, clearFailures, lockedMinutes, recordFailure } from "./lockout";

describe("account lockout", () => {
  it("locks after five wrong passwords in fifteen minutes, whatever the case of the email", () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure("Owner@Gym.in", t + i);
    expect(lockedMinutes("owner@gym.in", t + 10)).toBe(0);
    recordFailure("owner@gym.in", t + 10);
    expect(lockedMinutes("OWNER@gym.in", t + 11)).toBe(15);
  });

  it("opens again when the window has passed, and a right password clears the count", () => {
    const t = 5_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("a@b.in", t);
    expect(lockedMinutes("a@b.in", t + WINDOW_MS - 1)).toBe(1);
    expect(lockedMinutes("a@b.in", t + WINDOW_MS)).toBe(0);
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("c@d.in", t);
    clearFailures("c@d.in");
    expect(lockedMinutes("c@d.in", t)).toBe(0);
  });
});
