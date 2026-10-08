import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";
import { defaultForm, emptyStaff, stepsFor, type OnboardingForm, type StepKey } from "@/lib/domain/onboarding";
import { PLAN_FEATURES } from "@/lib/domain/features";
import { UserError } from "./errors";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { getTax } from "./tax";
import { getSetting } from "./settings";
import { getOnboarding, finishOnboarding, saveDraft, skipOnboarding, wizardStart } from "./onboarding";
import { todayIso } from "./time";

type Gym = Awaited<ReturnType<typeof makeGym>>;

const ALL = stepsFor((f) => PLAN_FEATURES.professional!.includes(f));
const STARTER = stepsFor((f) => PLAN_FEATURES.starter!.includes(f));
const GSTIN = "20ABCDE1234F1Z5";
/** Emails are unique across all gyms, so each test gym gets its own team member address (typed with capitals, stored lowercase). */
let ASHA = "";

/** A gym the way sign-up leaves it: one open branch, the gym profile, and the setup waiting. */
async function newGym(opts: { state?: object | null } = {}) {
  ASHA = `Asha-${randomUUID().slice(0, 8)}@Iron.test`;
  const gym = await makeGym();
  await db.branch.update({ where: { id: gym.a.id }, data: { name: "Main", address: "1 Station Road, Bokaro, 827004", phone: "9876543210" } });
  await db.branch.update({ where: { id: gym.b.id }, data: { active: false } });
  await db.setting.create({ data: { orgId: gym.org.id, key: "gym", value: { name: "Iron Den", city: "Bokaro" } } });
  if (opts.state !== null) await db.setting.create({ data: { orgId: gym.org.id, key: "onboarding", value: opts.state ?? { status: "PENDING" } } });
  return { gym, owner: await gym.user("Super Admin", [gym.a.id]) };
}

const filled = (over: Partial<OnboardingForm> = {}): OnboardingForm => {
  const f = defaultForm();
  return {
    ...f,
    tax: { gst: true, gstin: GSTIN.toLowerCase(), rate: "12", type: "IGST", prefix: "fit-", start: "2501" },
    branch: { short: "City Centre", hours: "05:30 – 22:30", manager: "Ravi Kumar" },
    rows: [
      { name: "Monthly", months: "1", price: "1,500", regFee: "500" },
      { name: "Annual", months: "12", price: "13000", regFee: "0" },
      { name: "Personal Training", months: "1", price: "6000", regFee: "" },
    ],
    staff: [{ name: "Asha Rao", role: "Trainer", phone: "+91 98765 43211", email: ASHA, password: "first-pass-1" }, emptyStaff()],
    wa: { welcome: true, d7: false, d3: true, d1: false, d0: true, birthday: false },
    opening: { cash: "₹12,500", bank: "2,40,000.50" },
    mode: "import",
    ...over,
  };
};

describe.skipIf(!hasDb)("first-run setup (database)", () => {
  let gym: Gym;
  let owner: Awaited<ReturnType<Gym["user"]>>;

  describe("applying the answers", () => {
    beforeAll(async () => {
      ({ gym, owner } = await newGym());
    });

    it("sets up billing, the branch, balances, WhatsApp, plans and the team from the answers", async () => {
      const r = await finishOnboarding(owner, filled(), ALL);
      expect(r).toEqual({ mode: "import", plansAdded: 3, staffAdded: 1 });
      const orgId = gym.org.id;

      // Billing & GST: the tax setting, the one place the prefix lives, and where numbering starts.
      expect(await getTax(orgId)).toMatchObject({ enabled: true, rate: 12, type: "IGST", gstin: GSTIN, sac: "999723" });
      expect(await getSetting(orgId, "numbering")).toMatchObject({ invoicePrefix: "FIT-" });
      expect((await db.sequence.findUniqueOrThrow({ where: { orgId_name: { orgId, name: "invoice" } } })).next).toBe(2501);

      // The branch keeps the address and phone it signed up with, and takes the GSTIN.
      expect(await db.branch.findUniqueOrThrow({ where: { id: gym.a.id } })).toMatchObject({
        name: "City Centre, Bokaro",
        short: "City Centre",
        hours: "05:30 – 22:30",
        manager: "Ravi Kumar",
        address: "1 Station Road, Bokaro, 827004",
        phone: "9876543210",
        gstin: GSTIN,
      });

      // Plans: prices are kept in paise; GST follows the gym's choice; the PT plan is recognised.
      const plans = await db.membershipPlan.findMany({ where: { orgId }, orderBy: { months: "asc" } });
      expect(plans.map((p) => [p.name, p.kind, p.months, p.price, p.regFee, p.gstApplicable, p.status])).toEqual([
        ["Monthly", "Membership", 1, 150000, 50000, true, "ACTIVE"],
        ["Personal Training", "Personal Training", 1, 600000, 0, true, "ACTIVE"],
        ["Annual", "Membership", 12, 1300000, 0, true, "ACTIVE"],
      ]);

      // Opening balances in paise, as of today.
      expect(await getSetting(orgId, "opening")).toEqual({ cash: 1250000, bank: 24000050, asOf: todayIso() });

      // WhatsApp: the six switches follow the answers.
      const on = Object.fromEntries((await db.whatsAppTemplate.findMany({ where: { orgId, key: { in: ["welcome", "exp7", "exp3", "exp1", "expired", "birthday"] } } })).map((t) => [t.key, t.autoSend]));
      expect(on).toEqual({ welcome: true, exp7: false, exp3: true, exp1: false, expired: true, birthday: false });

      // The team: the role, the branch, and a password that can sign in.
      const asha = await db.user.findFirstOrThrow({ where: { orgId, email: ASHA.toLowerCase() }, include: { role: true, branches: true } });
      expect(asha).toMatchObject({ name: "Asha Rao", phone: "9876543211", role: { name: "Trainer" } });
      expect(asha.branches.map((b) => b.branchId)).toEqual([gym.a.id]);
      expect(asha.passwordHash).not.toContain("first-pass-1");

      // Done: the draft is gone, and the whole thing is in the audit log.
      expect(await getOnboarding(orgId)).toMatchObject({ status: "DONE", draft: null });
      const done = await db.auditLog.findFirstOrThrow({ where: { orgId, action: "onboarding.complete" } });
      expect(done.after).toMatchObject({ gst: true, plansAdded: 3, staffAdded: 1, mode: "import" });
    });

    it("cannot be finished twice, nor the draft saved after it", async () => {
      await expect(finishOnboarding(owner, filled(), ALL)).rejects.toThrow("Setup is already finished.");
      await expect(saveDraft(owner, "tax", filled())).rejects.toThrow("Setup is already finished.");
      expect(await db.membershipPlan.count({ where: { orgId: gym.org.id } })).toBe(3);
    });
  });

  describe("when it is wrong", () => {
    it("stops before changing anything, and says which step is wrong", async () => {
      const { gym, owner } = await newGym();
      const bad = filled({ tax: { ...filled().tax, gstin: "" } });
      const e = await finishOnboarding(owner, bad, ALL).catch((x) => x);
      expect(e).toBeInstanceOf(UserError);
      expect(e).toMatchObject({ field: "tax", message: expect.stringContaining("GSTIN") });
      expect(await db.membershipPlan.count({ where: { orgId: gym.org.id } })).toBe(0);
      expect(await getSetting(gym.org.id, "tax")).toBeNull();
      expect(await getOnboarding(gym.org.id)).toMatchObject({ status: "PENDING" });
    });

    it("stops when a team member's email already belongs to another gym", async () => {
      const { gym, owner } = await newGym();
      const other = await makeGym();
      const taken = await other.user("Receptionist");
      const f = filled({ staff: [{ ...emptyStaff(), name: "Asha Rao", phone: "9876543211", email: taken.email, password: "first-pass-1" }] });
      await expect(finishOnboarding(owner, f, ALL)).rejects.toMatchObject({ field: "staff", message: expect.stringContaining(taken.email) });
      expect(await db.membershipPlan.count({ where: { orgId: gym.org.id } })).toBe(0);
      expect(await getOnboarding(gym.org.id)).toMatchObject({ status: "PENDING" });
    });

    it("is not available to a gym that was set up by hand", async () => {
      const { owner } = await newGym({ state: null });
      await expect(finishOnboarding(owner, filled(), ALL)).rejects.toThrow("Setup isn't available for this gym.");
      await expect(saveDraft(owner, "tax", filled())).rejects.toThrow("Setup isn't available for this gym.");
    });
  });

  describe("carrying on after a failure", () => {
    it("does not double the plans or the team when Finish is pressed again", async () => {
      const { gym, owner } = await newGym();
      await finishOnboarding(owner, filled(), ALL);
      // As if the last write had failed: the setup is still pending, everything else is already in place.
      await db.setting.update({ where: { orgId_key: { orgId: gym.org.id, key: "onboarding" } }, data: { value: { status: "PENDING" } } });
      const again = await finishOnboarding(owner, filled({ rows: [...filled().rows, { name: "Quarterly", months: "3", price: "4000", regFee: "0" }] }), ALL);
      expect(again).toMatchObject({ plansAdded: 1, staffAdded: 0 });
      expect(await db.membershipPlan.count({ where: { orgId: gym.org.id } })).toBe(4);
      expect(await db.user.count({ where: { orgId: gym.org.id, email: ASHA.toLowerCase() } })).toBe(1);
      expect(await getOnboarding(gym.org.id)).toMatchObject({ status: "DONE" });
    });
  });

  describe("invoice numbering", () => {
    it("starts where the owner says while there are no invoices", async () => {
      const { gym, owner } = await newGym();
      await finishOnboarding(owner, filled({ tax: { ...filled().tax, start: "7001" } }), ALL);
      expect((await db.sequence.findUniqueOrThrow({ where: { orgId_name: { orgId: gym.org.id, name: "invoice" } } })).next).toBe(7001);
    });

    it("never moves once an invoice exists: numbers stay gap-free", async () => {
      const { gym, owner } = await newGym({ state: { status: "SKIPPED" } });
      const plan = await createPlan(owner, { name: "Early", kind: "Membership", months: 1, price: 150000, regFee: 0, discount: 0, gstApplicable: true, features: [] });
      const member = await createMember(owner, { name: "First Member", gender: "Male", phone: "9822300009", source: "Walk-in", tags: [] });
      await sellMembership(owner, member.id, { planId: plan.id, startDate: todayIso(), discount: 0, includeRegFee: false, payAmount: 150000, payMethod: "UPI" });
      const before = await db.sequence.findUniqueOrThrow({ where: { orgId_name: { orgId: gym.org.id, name: "invoice" } } });
      await finishOnboarding(owner, filled({ tax: { ...filled().tax, start: "9000" } }), ALL);
      const after = await db.sequence.findUniqueOrThrow({ where: { orgId_name: { orgId: gym.org.id, name: "invoice" } } });
      expect(after.next).toBe(before.next);
      expect(before.next).not.toBe(9000);
    });
  });

  describe("a plan without the team, WhatsApp or accounts", () => {
    it("leaves those out even if the form carries answers for them", async () => {
      const { gym, owner } = await newGym();
      const r = await finishOnboarding(owner, filled(), STARTER);
      expect(r).toMatchObject({ plansAdded: 3, staffAdded: 0 });
      expect(await db.user.count({ where: { orgId: gym.org.id } })).toBe(1);
      expect(await db.whatsAppTemplate.count({ where: { orgId: gym.org.id } })).toBe(0);
      expect(await getSetting(gym.org.id, "opening")).toBeNull();
      expect(await getOnboarding(gym.org.id)).toMatchObject({ status: "DONE" });
    });

    it("does not complain about a half-typed team member the gym can't use", async () => {
      const { owner } = await newGym();
      const f = filled({ staff: [{ ...emptyStaff(), name: "x" }] });
      await expect(finishOnboarding(owner, f, STARTER)).resolves.toMatchObject({ staffAdded: 0 });
    });
  });

  describe("coming back to it", () => {
    it("keeps the answers, without the passwords, and carries on from them", async () => {
      const { gym, owner } = await newGym();
      expect((await wizardStart(gym.org.id)).form).toEqual(defaultForm());
      expect((await wizardStart(gym.org.id)).step).toBeNull();

      await saveDraft(owner, "plans" satisfies StepKey, filled());
      const stored = JSON.stringify((await db.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: gym.org.id, key: "onboarding" } } })).value);
      expect(stored).not.toContain("first-pass-1");
      const back = await wizardStart(gym.org.id);
      expect(back.step).toBe("plans");
      expect(back.form.branch.short).toBe("City Centre");
      expect(back.form.staff[0]).toMatchObject({ name: "Asha Rao", password: "" });
      expect(await getOnboarding(gym.org.id)).toMatchObject({ status: "PENDING", step: "plans" });
      // Nothing was applied by saving a draft.
      expect(await db.membershipPlan.count({ where: { orgId: gym.org.id } })).toBe(0);
    });

    it("lets the owner skip, keeps the draft, and finish later", async () => {
      const { gym, owner } = await newGym();
      await saveDraft(owner, "branch", filled());
      await skipOnboarding(owner);
      expect(await getOnboarding(gym.org.id)).toMatchObject({ status: "SKIPPED", step: "branch" });
      expect((await getOnboarding(gym.org.id))?.draft?.branch.short).toBe("City Centre");
      await skipOnboarding(owner);
      expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "setting.update", entityId: "onboarding" } })).toBe(1);
      await expect(finishOnboarding(owner, filled(), ALL)).resolves.toMatchObject({ plansAdded: 3 });
      await skipOnboarding(owner);
      expect(await getOnboarding(gym.org.id)).toMatchObject({ status: "DONE" });
    });
  });
});
