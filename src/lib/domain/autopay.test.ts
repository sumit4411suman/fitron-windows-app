import { describe, expect, it } from "vitest";
import { DEBIT_REASONS, seed, simulateDebit } from "./autopay";

const base = { mandateId: "m1", today: "2026-10-04", retries: 0, maxRetries: 3, retryGap: 2 };
describe("autopay simulation", () => {
  it("seed is deterministic and in [0,1)", () => {
    for (const s of ["a", "m1x", "zzzz1234"]) {
      expect(seed(s)).toBe(seed(s));
      expect(seed(s)).toBeGreaterThanOrEqual(0);
      expect(seed(s)).toBeLessThan(1);
    }
  });
  it("succeeds below 0.85 and fails from 0.85", () => {
    expect(simulateDebit({ ...base, roll: 0.84 })).toEqual({ ok: true });
    expect(simulateDebit({ ...base, roll: 0.85 }).ok).toBe(false);
  });
  it("a failure schedules a retry, then halts when retries run out", () => {
    const f = simulateDebit({ ...base, roll: 0.99 });
    expect(f).toMatchObject({ ok: false, halted: false, retries: 1, nextRetryOn: "2026-10-06" });
    if (!f.ok) {
      expect(f.lastResult).toMatch(/retry 1 of 3/);
      expect(DEBIT_REASONS).toContain(f.reason);
      expect(simulateDebit({ ...base, roll: 0.99 })).toEqual(f);
    }
    const h = simulateDebit({ ...base, retries: 3, roll: 0.99 });
    expect(h).toMatchObject({ ok: false, halted: true, nextRetryOn: null });
    if (!h.ok) expect(h.lastResult).toMatch(/3 retries used/);
  });
});
