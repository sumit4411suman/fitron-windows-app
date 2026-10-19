import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/domain/dates";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { compareOptions, createDecision, decide, getDecision, listDecisions, markImplemented, parseCriteria, recordReview, removeOption, reviewFigures, saveOption, updateDecision, DEFAULT_CRITERIA } from "./decisions";
import { baselineInputs } from "./simulator";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("business decision simulator (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<typeof gym.user>>;
  const today = todayIso();

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 120_000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const m = await createMember(admin, { name: "Member", gender: "Female", phone: "9876551001", source: "Walk-in", tags: [] });
    await sellMembership(admin, m.id, { planId: plan.id, startDate: addDays(today, -3), discount: 0, includeRegFee: false, payAmount: 120_000, payMethod: "Cash" });
  });

  it("creates a decision with the books as baseline, a do-nothing option and revision 1", async () => {
    const d = await createDecision(admin, { title: "Hire a second trainer", category: "HIRING", objective: "Serve evening members without queues", constraints: "Under ₹30,000 a month", reviewDays: 60 });
    const full = await getDecision(admin, d.id);
    expect(full.status).toBe("DRAFT");
    expect(full.options).toHaveLength(1);
    expect(full.options[0]!.name).toBe("Do nothing (baseline)");
    expect(full.revisions).toHaveLength(1);
    expect((full.baseline as { activeMembers: number }).activeMembers).toBe(1);
    expect(parseCriteria(full.criteria)).toEqual(DEFAULT_CRITERIA);
    await expect(createDecision(admin, { title: "", category: "HIRING", objective: "x" })).rejects.toThrow("title");
  });

  it("adds options through the Profit Simulator, scores them apart from the figures, and versions every save", async () => {
    const d = (await listDecisions(admin))[0]!;
    const base = await baselineInputs(admin, today);
    const hire = await saveOption(admin, d.id, { name: "Hire", inputs: { ...base.inputs, fixed: { ...base.inputs.fixed, salaries: base.inputs.fixed.salaries + 2_500_000 }, newMembersPerMonth: base.inputs.newMembersPerMonth + 4 }, scores: { members: 5, staff: 4, risk: 3 }, benefits: "More evening capacity", costs: "₹25,000 a month", risks: "Members may not come" });
    expect((hire.results as { calcVersion: number }).calcVersion).toBe(1);
    let full = await getDecision(admin, d.id);
    expect(full.version).toBe(2);
    expect(full.revisions[0]!.note).toContain('Added option "Hire"');
    await saveOption(admin, d.id, { name: "Hire part-time", inputs: { ...base.inputs, fixed: { ...base.inputs.fixed, salaries: base.inputs.fixed.salaries + 1_000_000 } }, scores: { members: 3, staff: 3, risk: 4 } }, hire.id);
    full = await getDecision(admin, d.id);
    expect(full.options.find((o) => o.id === hire.id)!.name).toBe("Hire part-time");
    expect(full.version).toBe(3);
    await updateDecision(admin, d.id, { objective: "Serve evening members and sell personal training" }, "Widened the objective");
    full = await getDecision(admin, d.id);
    expect(full.version).toBe(4);
    expect(full.revisions.map((r) => r.version)).toEqual([4, 3, 2, 1]);
    const cmp = compareOptions(full.options, parseCriteria(full.criteria));
    expect(cmp).toHaveLength(2);
    const chosen = cmp.find((c) => c.id === hire.id)!;
    expect(chosen.per.find((p) => p.key === "financial")!.calculated).toBe(true);
    expect(chosen.per.find((p) => p.key === "members")!.score).toBe(3);
    expect(chosen.weighted).not.toBeNull();
    expect(chosen.variants.conservative.totals.operatingProfit).toBeLessThanOrEqual(chosen.variants.baseline.totals.operatingProfit);
    const nothing = cmp.find((c) => c.id !== hire.id)!;
    expect(nothing.unscored.length).toBe(3);
    await expect(saveOption(admin, d.id, { name: "Bad", inputs: { ...base.inputs, months: 99 } })).rejects.toThrow("Forecast months");
  });

  it("is approved by the owner with a chosen option and reasoning, never by itself, then implemented and reviewed", async () => {
    const d = (await listDecisions(admin))[0]!;
    const option = (await getDecision(admin, d.id)).options.find((o) => o.name === "Hire part-time")!;
    const acct = pick(await gym.user("Accountant"), gym.a.id);
    await expect(decide(acct, d.id, "APPROVED", { optionId: option.id, rationale: "x" })).rejects.toThrow("Only a Super Admin");
    await expect(decide(admin, d.id, "APPROVED", { rationale: "Fits the budget" })).rejects.toThrow("Choose the option");
    await expect(decide(admin, d.id, "APPROVED", { optionId: option.id, rationale: "" })).rejects.toThrow("reasoning");
    await decide(admin, d.id, "DEFERRED", { rationale: "Wait for the festive season", deferredUntil: addDays(today, 30) });
    expect((await getDecision(admin, d.id)).status).toBe("DEFERRED");
    await decide(admin, d.id, "APPROVED", { optionId: option.id, rationale: "Fits the budget and the evening demand" });
    let full = await getDecision(admin, d.id);
    expect(full).toMatchObject({ status: "APPROVED", selectedId: option.id, decidedById: admin.id });
    await expect(removeOption(admin, d.id, option.id)).rejects.toThrow("chosen option");
    await expect(markImplemented(admin, d.id, addDays(today, 1))).rejects.toThrow("future");
    await markImplemented(admin, d.id, addDays(today, -10));
    full = await getDecision(admin, d.id);
    expect(full.status).toBe("IMPLEMENTED");
    await expect(saveOption(admin, d.id, { name: "Late", inputs: (await baselineInputs(admin, today)).inputs })).rejects.toThrow("implemented");
    const review = await reviewFigures(admin, d.id, today);
    expect(review).not.toBeNull();
    expect(review!.from).toBe(addDays(today, -10));
    expect(review!.to).toBe(addDays(today, -1));
    expect(review!.ready).toBe(false); // 60 days have not passed
    expect(review!.projected).not.toBeNull();
    expect(review!.actual.revenue).toBeGreaterThanOrEqual(0);
    await recordReview(admin, d.id, "Evening attendance rose; keep the trainer.");
    full = await getDecision(admin, d.id);
    expect(full.status).toBe("REVIEWED");
    expect(full.lessons).toContain("keep the trainer");
    expect((full.actual as { from: string }).from).toBe(addDays(today, -10));
    expect(full.revisions[0]!.note).toBe("Reviewed");
    await expect(updateDecision(admin, d.id, { title: "x" })).rejects.toThrow("history");
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: { startsWith: "bi.decision." } } })).toBeGreaterThanOrEqual(8);
  });

  it("keeps decisions to their gym", async () => {
    const other = await makeGym();
    const otherAdmin = await other.user("Super Admin");
    const d = (await listDecisions(admin))[0]!;
    await expect(getDecision(otherAdmin, d.id)).rejects.toThrow("not found");
    await expect(decide(otherAdmin, d.id, "REJECTED", { rationale: "nope" })).rejects.toThrow("not found");
    expect(await listDecisions(otherAdmin)).toEqual([]);
  });
});
