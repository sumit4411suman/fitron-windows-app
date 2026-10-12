import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember, listMembers, summarize } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { lastRenewalReminders, renewalAmounts } from "./reminders";
import { computeRisk } from "./insights";
import { todayIso } from "./time";

// A gym with more members than SQLite takes values in one statement (999): the member list, renewals and risk scores
// ask about every member at once. On FITRON for Windows that failed outright before long lists were read in slices
// (src/lib/runtime/sqlite-in.ts); on fitron.in it must work the same.

const N = 1_200;

describe.skipIf(!hasDb)("a gym with more than a thousand members (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let ids: string[];

  beforeAll(async () => {
    gym = await makeGym();
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const first = await createMember(admin, { name: "First Member", gender: "Male", phone: "9833000000", source: "Walk-in", tags: [] });
    await sellMembership(admin, first.id, { planId: plan.id, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 0 });
    const template = await db.member.findUniqueOrThrow({ where: { id: first.id } });
    const tag = randomUUID().slice(0, 6);
    const rows = Array.from({ length: N - 1 }, (_, i) => ({ ...template, id: `mm${tag}${i}`, code: `FT-${tag}-${i}`, name: `Member ${i}`, phone: `98${String(34_000_000 + i).padStart(8, "0")}` }));
    for (let i = 0; i < rows.length; i += 300) await db.member.createMany({ data: rows.slice(i, i + 300) });
    ids = [first.id, ...rows.map((r) => r.id)];
  });

  it("lists every member with their status and balance", async () => {
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    const all = await listMembers(admin, { all: true });
    expect(all.total).toBe(N);
    expect(all.rows.find((r) => r.name === "First Member")).toMatchObject({ planName: "Monthly", outstanding: 150000 });
    const page = await listMembers(admin, { page: 3, pageSize: 50 });
    expect(page.rows).toHaveLength(50);
    expect((await listMembers(admin, { status: "DUE", all: true })).total).toBe(1);
    // Balances added up in the database for a long list are the ones worked out invoice by invoice for one member.
    const many = await summarize(ids);
    for (const id of ids.slice(0, 3)) expect(many.get(id)).toEqual((await summarize([id])).get(id));
  });

  it("renewals and risk scores cover every member", async () => {
    expect((await lastRenewalReminders(ids)).size).toBe(0);
    expect((await renewalAmounts(ids)).size).toBe(1);
    await computeRisk(gym.org.id);
    expect(await db.member.count({ where: { orgId: gym.org.id, riskScore: { not: null } } })).toBe(N);
  });
});
