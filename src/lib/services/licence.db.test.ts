import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { isLocal } from "@/lib/runtime/edition";
import { LICENCE_ENDED_MESSAGE } from "@/lib/licence";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { collectPayment, sellMembership } from "./billing";
import { saveBranch } from "./settings";

// FITRON for Windows as shipped, on a computer whose free trial has ended: nothing new is added, but what is there
// stays usable. Each test gets its own data folder, so the licence files of one never reach another.

let root = "";
const installedDaysAgo = (n: number) => writeFileSync(path.join(root, "secrets.json"), JSON.stringify({ installationId: "test-install", createdAt: new Date(Date.now() - n * 86_400_000).toISOString() }));

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fitron-licence-db-"));
  vi.stubEnv("FITRON_DATA_DIR", root);
  vi.stubEnv("FITRON_LOCAL_ALLOW_SIGNUP", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasDb || !isLocal())("the licence on FITRON for Windows (database)", () => {
  it("in the trial everything works; once it has ended nothing new is added, and dues can still be collected", async () => {
    installedDaysAgo(10);
    const g = await makeGym();
    const owner = pick(await g.user("Super Admin"), g.a.id);
    const plan = await createPlan(owner, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const m = await createMember(owner, { name: "Trial Member", gender: "Male", phone: "9866640001", source: "Walk-in", tags: [] });
    const sale = await sellMembership(owner, m.id, { planId: plan.id, startDate: new Date().toISOString().slice(0, 10), discount: 0, includeRegFee: false, payAmount: 40000, payMethod: "Cash" });

    installedDaysAgo(45);
    await expect(createMember(owner, { name: "After Trial", gender: "Male", phone: "9866640002", source: "Walk-in", tags: [] })).rejects.toThrow(LICENCE_ENDED_MESSAGE);
    // Starting after the trial sale's plan, so the only reason to refuse it is the licence (an overlap is refused first).
    await expect(sellMembership(owner, m.id, { planId: plan.id, startDate: new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10), discount: 0, includeRegFee: false, payAmount: 0 })).rejects.toThrow(LICENCE_ENDED_MESSAGE);
    // The balance of the sale made in the trial can still be collected.
    await collectPayment(owner, sale.invoice.id, { amount: 60000, method: "UPI", date: new Date().toISOString().slice(0, 10) });
    expect((await db.payment.aggregate({ where: { invoiceId: sale.invoice.id, status: "SUCCESS" }, _sum: { amount: true } }))._sum.amount).toBe(100000);
  });

  it("allows the licence's branches, not the plan's", async () => {
    installedDaysAgo(1);
    const g = await makeGym();
    const owner = pick(await g.user("Super Admin"), g.a.id);
    // makeGym opens two branches; the trial allows three.
    const branch = (name: string) => ({ name, short: name, address: "MG Road, Pune", phone: "9876500000", hours: "6am to 10pm" });
    await saveBranch(owner, null, branch("Third"));
    await expect(saveBranch(owner, null, branch("Fourth"))).rejects.toThrow(/licence covers 3 active branches/);
  });
});
