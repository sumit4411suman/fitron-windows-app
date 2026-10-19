import { describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY_RULES, aging, duesEligible, duesNextAction, duesPriority, renewalNextAction, renewalPriority, withRecoveryDefaults } from "./recovery";

const rules = DEFAULT_RECOVERY_RULES;
const today = "2026-10-19";

describe("recovery rules", () => {
  it("clamps saved settings and fills gaps with the defaults", () => {
    expect(withRecoveryDefaults(null)).toEqual(rules);
    expect(withRecoveryDefaults({ graceDays: 500, minBalance: -1, followUpEveryDays: NaN })).toMatchObject({ graceDays: 90, minBalance: 0, followUpEveryDays: 3 });
  });
  it("puts past-due and part-paid invoices in the queue, not tiny balances or those not yet due", () => {
    expect(duesEligible({ balance: 150_000, overdueDays: 1, partPaid: false }, rules)).toBe(true);
    expect(duesEligible({ balance: 150_000, overdueDays: 0, partPaid: false }, rules)).toBe(false);
    expect(duesEligible({ balance: 150_000, overdueDays: 0, partPaid: true }, rules)).toBe(true);
    expect(duesEligible({ balance: 5_000, overdueDays: 40, partPaid: false }, rules)).toBe(false);
    expect(duesEligible({ balance: 150_000, overdueDays: 3, partPaid: false }, { ...rules, graceDays: 5 })).toBe(false);
  });
});

describe("dues priority", () => {
  const base = { balance: 500_000, overdueDays: 30, memberActive: true, hasAutopay: false, attempts: 0, promisedOn: null, today };
  it("rises with amount and age and stays within 0–100", () => {
    const p = duesPriority(base);
    expect(p).toBeGreaterThan(duesPriority({ ...base, balance: 50_000 }));
    expect(p).toBeGreaterThan(duesPriority({ ...base, overdueDays: 3 }));
    const top = duesPriority({ ...base, balance: 50_000_000, overdueDays: 400 });
    expect(top).toBeGreaterThanOrEqual(90);
    expect(top).toBeLessThanOrEqual(100);
    expect(duesPriority({ ...base, balance: 0, overdueDays: 0, memberActive: false, hasAutopay: true, attempts: 9 })).toBe(0);
  });
  it("waits on a live promise and an autopay mandate", () => {
    expect(duesPriority({ ...base, promisedOn: "2026-10-25" })).toBe(duesPriority(base) - 20);
    expect(duesPriority({ ...base, promisedOn: "2026-10-01" })).toBe(duesPriority(base));
    expect(duesPriority({ ...base, hasAutopay: true })).toBe(duesPriority(base) - 15);
  });
  it("is deterministic", () => {
    expect(duesPriority(base)).toBe(duesPriority({ ...base }));
  });
});

describe("dues next action", () => {
  const f = { balance: 500_000, overdueDays: 10, memberActive: true, hasAutopay: false, attempts: 0, promisedOn: null, today };
  it("starts with a message, moves to a call, then to a review", () => {
    expect(duesNextAction(f, rules, null)).toEqual({ action: "Send a WhatsApp reminder", on: today, kind: "message" });
    expect(duesNextAction({ ...f, attempts: 1 }, rules, "2026-10-18")).toEqual({ action: "Send another WhatsApp reminder", on: "2026-10-21", kind: "message" });
    expect(duesNextAction({ ...f, attempts: 2 }, rules, "2026-10-10").kind).toBe("call");
    expect(duesNextAction({ ...f, attempts: 2 }, rules, "2026-10-10").on).toBe(today);
    expect(duesNextAction({ ...f, attempts: 5 }, rules, "2026-10-10").kind).toBe("review");
  });
  it("waits for a promise and checks a mandate first", () => {
    expect(duesNextAction({ ...f, promisedOn: "2026-10-25" }, rules, null)).toMatchObject({ kind: "wait", on: "2026-10-25" });
    expect(duesNextAction({ ...f, hasAutopay: true }, rules, null).kind).toBe("review");
    expect(duesNextAction({ ...f, hasAutopay: true, attempts: 1 }, rules, null).kind).toBe("message");
  });
});

describe("renewal opportunities", () => {
  const f = { lastPrice: 300_000, daysSinceEnd: 5, recentVisits: 6, tenureMemberships: 3, hasDues: false };
  it("prefers fresh lapses, regular visitors and long-standing members", () => {
    expect(renewalPriority(f)).toBeGreaterThan(renewalPriority({ ...f, daysSinceEnd: 45 }));
    expect(renewalPriority(f)).toBeGreaterThan(renewalPriority({ ...f, recentVisits: 0 }));
    expect(renewalPriority(f)).toBeGreaterThan(renewalPriority({ ...f, tenureMemberships: 1 }));
    expect(renewalPriority(f)).toBeGreaterThan(renewalPriority({ ...f, hasDues: true }));
    expect(renewalPriority({ ...f, lastPrice: 100_000_000, daysSinceEnd: 1, recentVisits: 20, tenureMemberships: 10 })).toBe(95);
  });
  it("suggests a message, then a call, then a review", () => {
    expect(renewalNextAction(f, 0, null, today, rules)).toEqual({ action: "Send a renewal message", on: today, kind: "message" });
    expect(renewalNextAction(f, 2, "2026-10-18", today, rules)).toMatchObject({ kind: "call", on: "2026-10-21" });
    expect(renewalNextAction(f, 5, null, today, rules).kind).toBe("review");
  });
});

describe("ageing", () => {
  it("lists every bucket in order with counts and amounts", () => {
    const rows = aging([
      { balance: 100, overdueDays: 0 },
      { balance: 200, overdueDays: 15 },
      { balance: 300, overdueDays: 45 },
      { balance: 400, overdueDays: 100 },
      { balance: 500, overdueDays: 100 },
    ]);
    expect(rows.map((r) => r.bucket)).toEqual(["Not yet due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"]);
    expect(rows[3]).toEqual({ bucket: "61–90 days", count: 0, amount: 0 });
    expect(rows[4]).toEqual({ bucket: "Over 90 days", count: 2, amount: 900 });
  });
});
