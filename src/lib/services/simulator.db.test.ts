import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createExpense } from "./expenses";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { archiveScenario, baselineInputs, bestScenario, createScenario, duplicateScenario, getScenario, listScenarios, scenarioReportRows, scenarioResult, scenarioVersusActual, updateScenario } from "./simulator";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("profit simulator (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<typeof gym.user>>;
  const today = todayIso();

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const monthly = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150_000, regFee: 0, discount: 0, gstApplicable: true, features: [] });
    await createPlan(admin, { name: "Yearly", kind: "Membership", months: 12, price: 1_200_000, regFee: 0, discount: 0, gstApplicable: true, features: [] });
    for (const [i, name] of ["One", "Two", "Three"].entries()) {
      const m = await createMember(admin, { name, gender: "Male", phone: `987654100${i}`, source: "Walk-in", tags: [] });
      await sellMembership(admin, m.id, { planId: monthly.id, startDate: addDays(today, -5), discount: i === 0 ? 15_000 : 0, includeRegFee: false, payAmount: 0 });
    }
    await createExpense(admin, { date: today, categoryId: "rent", description: "Rent", amount: 3_000_000, method: "Bank Transfer" });
    await createExpense(admin, { date: today, categoryId: "electricity", description: "Power", amount: 600_000, method: "UPI" });
  });

  it("reads the baseline from the books: the live mix, prices before GST, and three-month average costs", async () => {
    const b = await baselineInputs(admin, today);
    const monthly = b.inputs.plans.find((p) => p.name === "Monthly")!;
    expect(monthly).toMatchObject({ members: 3, price: 150_000, months: 1 });
    expect(monthly.discountPct).toBe(3.3); // 15,000 off one of three sales
    expect(b.inputs.plans.find((p) => p.name === "Yearly")).toMatchObject({ members: 0, price: 1_200_000, months: 12 });
    expect(b.inputs.pricesIncludeGst).toBe(false);
    expect(b.inputs.gstRatePct).toBe(18);
    expect(b.inputs.fixed.rent).toBe(1_000_000);
    expect(b.inputs.fixed.utilities).toBe(200_000);
    expect(b.inputs.newMembersPerMonth).toBe(1);
    expect(b.snapshot.activeMembers).toBe(3);
    expect(b.notes.some((n) => n.includes("before GST"))).toBe(true);
  });

  it("saves, edits, duplicates and archives scenarios without touching a single financial record", async () => {
    const invoices = await db.invoice.count({ where: { orgId: gym.org.id } });
    const payments = await db.payment.count({ where: { orgId: gym.org.id } });
    const expenses = await db.expense.count({ where: { orgId: gym.org.id } });
    const b = await baselineInputs(admin, today);
    const raised = { ...b.inputs, plans: b.inputs.plans.map((p) => ({ ...p, price: Math.round(p.price * 1.1) })) };
    const s = await createScenario(admin, { name: "Raise prices 10%", note: "Test", inputs: raised });
    expect(s.calcVersion).toBe(1);
    expect(s.baselineFrom).toBe(b.from);
    const { result, recomputed } = scenarioResult(s);
    expect(recomputed).toBe(false);
    expect(result.months).toHaveLength(12);
    expect(result.totals.operatingProfit).toBeGreaterThan(b.inputs.months > 0 ? -Infinity : 0);
    await updateScenario(admin, s.id, { name: "Raise prices 12%", inputs: { ...raised, newMembersPerMonth: 5 } });
    const after = await getScenario(admin, s.id);
    expect(after.name).toBe("Raise prices 12%");
    expect((after.inputs as { newMembersPerMonth: number }).newMembersPerMonth).toBe(5);
    const copy = await duplicateScenario(admin, s.id);
    expect(copy.name).toBe("Raise prices 12% (copy)");
    await archiveScenario(admin, copy.id);
    expect((await listScenarios(admin)).map((x) => x.id)).toEqual([s.id]);
    expect((await listScenarios(admin, true)).length).toBe(2);
    await expect(updateScenario(admin, copy.id, { name: "x" })).rejects.toThrow("archived");
    await expect(createScenario(admin, { name: "Bad", inputs: { ...raised, months: 0 } })).rejects.toThrow("Forecast months");
    expect(await db.invoice.count({ where: { orgId: gym.org.id } })).toBe(invoices);
    expect(await db.payment.count({ where: { orgId: gym.org.id } })).toBe(payments);
    expect(await db.expense.count({ where: { orgId: gym.org.id } })).toBe(expenses);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: { startsWith: "bi.scenario." } } })).toBeGreaterThanOrEqual(4);
  });

  it("finds the scenario that beats the baseline most, and exports a report with assumptions and months", async () => {
    const best = await bestScenario(admin);
    expect(best?.name).toBe("Raise prices 12%");
    expect(best!.extraProfit).toBeGreaterThan(0);
    const s = await getScenario(admin, best!.id);
    const rep = scenarioReportRows(s, scenarioResult(s).result.months.length ? (await import("@/lib/domain/simulator")).parseInputs(s.inputs) : (await import("@/lib/domain/simulator")).parseInputs(s.inputs), scenarioResult(s).result);
    expect(rep.assumptions[0]).toEqual(["Scenario", "Raise prices 12%"]);
    expect(rep.columns[0]).toBe("Month");
    expect(rep.rows).toHaveLength(13);
    expect(rep.rows[12]![0]).toBe("Total");
  });

  it("compares a forecast only with months that have passed", async () => {
    const s = (await listScenarios(admin))[0]!;
    const v = await scenarioVersusActual(admin, s.id, today);
    // The baseline ends today, so no forecast month has passed yet.
    expect(v.months).toEqual([]);
    expect(v.firstMonth > today.slice(0, 7)).toBe(true);
  });

  it("keeps scenarios to their gym", async () => {
    const other = await makeGym();
    const otherAdmin = await other.user("Super Admin");
    const s = (await listScenarios(admin))[0]!;
    await expect(getScenario(otherAdmin, s.id)).rejects.toThrow("not found");
    expect(await listScenarios(otherAdmin)).toEqual([]);
  });
});
