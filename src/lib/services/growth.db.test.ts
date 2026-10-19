import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createExpense } from "./expenses";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { decideRecommendation, growthInputs, growthPeriods, listRecommendations, measureOutcome, recommendationHistory, refreshRecommendations } from "./growth";
import { refreshQueue } from "./recovery";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("growth engine (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<typeof gym.user>>;
  const today = todayIso();
  const { period, previous } = growthPeriods(today);

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 200_000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    // Last month: six invoices never paid and long overdue, so the recovery backlog rule fires.
    for (let i = 0; i < 6; i++) {
      const m = await createMember(admin, { name: `Owing ${i}`, gender: "Male", phone: `987656100${i}`, source: "Walk-in", tags: [] });
      const s = await sellMembership(admin, m.id, { planId: plan.id, startDate: addDays(period.from, i), discount: 0, includeRegFee: false, payAmount: 0 });
      await db.invoice.update({ where: { id: s.invoice.id }, data: { date: new Date(`${addDays(period.from, i)}T00:00:00Z`), dueDate: new Date(`${addDays(period.from, i)}T00:00:00Z`) } });
    }
    // Utilities doubled against the month before.
    await createExpense(admin, { date: previous.from, categoryId: "electricity", description: "Power", amount: 1_000_000, method: "UPI" });
    await createExpense(admin, { date: period.from, categoryId: "electricity", description: "Power", amount: 2_000_000, method: "UPI" });
    await refreshQueue(admin, today);
  });

  it("reads its inputs from the other modules, never from figures of its own", async () => {
    const i = await growthInputs(admin, today);
    expect(i.period.from).toBe(period.from);
    expect(i.recovery.openCases).toBe(6);
    expect(i.recovery.eligible).toBe(1_200_000);
    expect(i.expenseGroups.find((g) => g.group === "Utilities")).toEqual({ group: "Utilities", amount: 2_000_000, previous: 1_000_000 });
    expect(i.ltvEstimate).toBeNull();
    expect(i.cac).toBeNull();
  });

  it("raises evidence-backed recommendations, ranks them, and refreshes without duplicating", async () => {
    const r = await refreshRecommendations(admin, today);
    expect(r.added).toBeGreaterThanOrEqual(2);
    const open = await listRecommendations(admin);
    const rules = open.map((x) => x.rule).sort();
    expect(rules).toContain("recovery.backlog");
    expect(rules).toContain("expense.rise");
    const backlog = open.find((x) => x.rule === "recovery.backlog")!;
    expect(backlog.impactPaise).toBe(1_200_000);
    expect(backlog.score).toBeGreaterThan(0);
    const ev = backlog.evidence as { metric: string; value: number; kind: string }[];
    expect(ev.find((e) => e.metric === "recovery.eligible")).toMatchObject({ value: 1_200_000, kind: "actual" });
    expect(open[0]!.score).toBeGreaterThanOrEqual(open[open.length - 1]!.score);
    const again = await refreshRecommendations(admin, today);
    expect(again.added).toBe(0);
    expect(again.updated).toBe(r.added);
    expect((await listRecommendations(admin)).length).toBe(open.length);
    expect(await db.recommendation.count({ where: { orgId: gym.org.id, key: backlog.key } })).toBe(1);
  });

  it("is decided by a person and keeps the decision across refreshes, with a measured outcome on completion", async () => {
    const backlog = (await listRecommendations(admin)).find((x) => x.rule === "recovery.backlog")!;
    const trainer = await gym.user("Trainer", [gym.a.id]);
    await expect(decideRecommendation(trainer, backlog.id, "ACCEPTED")).rejects.toThrow("can't act");
    await expect(decideRecommendation(admin, backlog.id, "DEFERRED")).rejects.toThrow("until when");
    await decideRecommendation(admin, backlog.id, "ACCEPTED", { note: "Front desk will call this week" });
    await refreshRecommendations(admin, today);
    let row = (await listRecommendations(admin, "all")).find((x) => x.id === backlog.id)!;
    expect(row.status).toBe("ACCEPTED");
    expect(row.outcomeNote).toBe("Front desk will call this week");
    await decideRecommendation(admin, backlog.id, "COMPLETED", { note: "Three paid" });
    row = (await listRecommendations(admin, "all")).find((x) => x.id === backlog.id)!;
    expect(row.status).toBe("COMPLETED");
    const outcome = row.outcome as { rows: { metric: string; then: number; now: number | null }[] };
    expect(outcome.rows.find((r) => r.metric === "recovery.eligible")).toMatchObject({ then: 1_200_000, now: 1_200_000 });
    const expense = (await listRecommendations(admin)).find((x) => x.rule === "expense.rise")!;
    await decideRecommendation(admin, expense.id, "DISMISSED", { note: "One-off bill" });
    const h = await recommendationHistory(admin);
    expect(h.tally).toMatchObject({ completed: 1, dismissed: 1 });
    const m = await measureOutcome(admin, expense, today);
    expect(m.rows[0]!.metric).toBe("fin.expenses.Utilities");
  });

  it("says nothing for a gym with no data, and nothing about another gym", async () => {
    const other = await makeGym();
    const otherAdmin = await other.user("Super Admin");
    const r = await refreshRecommendations(otherAdmin, today);
    expect(r).toMatchObject({ added: 0, updated: 0 });
    expect(await listRecommendations(otherAdmin, "all")).toEqual([]);
    const mine = (await listRecommendations(admin, "all"))[0]!;
    await expect(decideRecommendation(otherAdmin, mine.id, "DISMISSED")).rejects.toThrow("not found");
  });
});
