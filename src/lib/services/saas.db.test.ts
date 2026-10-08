import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { saveBranch } from "./settings";
import { createMember } from "./members";
import { applyFitronBillingEvent, billingReminders, branchStandings, confirmCheckout, confirmDemoPayment, startBranchPayment } from "./saas";
import { fromIso, todayIso } from "./time";

describe.skipIf(!hasDb)("Fitron branch plan (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let owner: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  const today = todayIso();
  const branch = (name: string) => ({ name, address: "Main Road", phone: "9000000001" });
  let fourth: string;

  beforeAll(async () => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "");
    gym = await makeGym();
    owner = await gym.user("Super Admin");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("includes 3 branches and asks for a paid slot for the 4th", async () => {
    await saveBranch(owner, null, branch("C"));
    await expect(saveBranch(owner, null, branch("D"))).rejects.toThrow(/includes 3 branches/);
    expect(await db.branch.count({ where: { orgId: gym.org.id } })).toBe(3);

    const c = await startBranchPayment(owner, "YEARLY", null);
    expect(c).toMatchObject({ mode: "DEMO", total: 4_99_000 });
    const paid = await confirmDemoPayment(owner, c.id);
    expect(paid?.invoiceNo).toMatch(/^FIT\/\d{4}-\d{2}\/\d{5}$/);
    expect(paid?.periodStart?.toISOString().slice(0, 10)).toBe(today);
    // Confirming twice changes nothing.
    expect((await confirmDemoPayment(owner, c.id))?.invoiceNo).toBe(paid?.invoiceNo);

    await saveBranch(owner, null, branch("D"));
    const d = await db.branch.findFirstOrThrow({ where: { orgId: gym.org.id, name: "D" } });
    fourth = d.id;
    expect((await db.branchSubscription.findUniqueOrThrow({ where: { id: c.id } })).branchId).toBe(fourth);
    const s = await branchStandings(gym.org.id, today);
    expect(s.branches.map((b) => b.standing.kind)).toEqual(["INCLUDED", "INCLUDED", "INCLUDED", "PAID"]);
    await expect(saveBranch(owner, null, branch("E"))).rejects.toThrow(/includes 3 branches/);
  });

  it("gives 7 days' grace after the period ends, then blocks new members and invoices until renewed", async () => {
    const sub = await db.branchSubscription.findFirstOrThrow({ where: { branchId: fourth } });
    const inD = pick(owner, fourth);
    await db.branchSubscription.update({ where: { id: sub.id }, data: { periodEnd: fromIso(addDays(today, -3)) } });
    expect((await branchStandings(gym.org.id, today)).branches[3]!.standing.kind).toBe("GRACE");
    await createMember(inD, { name: "Grace Guest", gender: "Female", phone: "9866600001", source: "Walk-in", tags: [] });
    expect((await billingReminders(gym.org.id, today)).sent).toBe(1);
    // A closed extra branch has nothing to renew.
    await db.branch.update({ where: { id: fourth }, data: { active: false } });
    expect((await billingReminders(gym.org.id, today)).sent).toBe(0);
    await db.branch.update({ where: { id: fourth }, data: { active: true } });

    await db.branchSubscription.update({ where: { id: sub.id }, data: { periodEnd: fromIso(addDays(today, -8)) } });
    expect((await branchStandings(gym.org.id, today)).branches[3]!.standing).toEqual({ kind: "READ_ONLY", since: today });
    await expect(createMember(inD, { name: "Blocked Bina", gender: "Female", phone: "9866600002", source: "Walk-in", tags: [] })).rejects.toThrow(/read-only/);
    // Other branches carry on.
    await createMember(pick(owner, gym.a.id), { name: "Fine Farah", gender: "Female", phone: "9866600003", source: "Walk-in", tags: [] });

    const r = await startBranchPayment(owner, "MONTHLY", fourth);
    const renewed = await confirmDemoPayment(owner, r.id);
    expect(renewed?.periodStart?.toISOString().slice(0, 10)).toBe(today);
    expect((await branchStandings(gym.org.id, today)).branches[3]!.standing.kind).toBe("PAID");
    await createMember(inD, { name: "Back Bina", gender: "Female", phone: "9866600002", source: "Walk-in", tags: [] });
    await expect(startBranchPayment(owner, "MONTHLY", gym.a.id)).rejects.toThrow(/included/);
  });

  it("with Fitron's Razorpay keys, a payment with no Razorpay plan (yearly branch) is one order: checks Checkout's signature, and applies the webhook once", async () => {
    const oid = `order_${randomUUID().slice(0, 12)}`;
    const pid = `pay_${randomUUID().slice(0, 12)}`;
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "rzp_test_x");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: oid, amount: 4_99_000, status: "created" }), { status: 200 })));
    const c = await startBranchPayment(owner, "YEARLY", fourth);
    expect(c).toMatchObject({ mode: "LIVE", orderId: oid, keyId: "rzp_test_x", total: 4_99_000 });
    await expect(confirmCheckout(owner, { orderId: oid, paymentId: pid, signature: "forged" })).rejects.toThrow(/couldn't confirm/);
    const sig = createHmac("sha256", "secret").update(`${oid}|${pid}`).digest("hex");
    const other = await makeGym();
    await expect(confirmCheckout(await other.user("Super Admin"), { orderId: oid, paymentId: pid, signature: sig })).rejects.toThrow(/not found/);
    const done = await confirmCheckout(owner, { orderId: oid, paymentId: pid, signature: sig });
    expect(done?.status).toBe("PAID");
    // The earlier monthly period is extended, not overlapped.
    const prev = await db.branchSubscription.findFirstOrThrow({ where: { branchId: fourth, cycle: "MONTHLY", NOT: { id: c.id } } });
    expect(done?.periodStart?.toISOString().slice(0, 10)).toBe(addDays(prev.periodEnd!.toISOString().slice(0, 10), 1));
    expect(await applyFitronBillingEvent({ event: "payment.captured", payload: { payment: { entity: { id: pid, order_id: oid } } } })).toBe("paid");
    expect(await db.branchSubscription.count({ where: { razorpayOrderId: oid, status: "PAID" } })).toBe(1);
    vi.unstubAllEnvs();
  });

  it("on a live server, a gym can't start or confirm a demo payment (it would mark its own plan paid)", async () => {
    vi.stubEnv("FITRON_RAZORPAY_KEY_ID", "");
    vi.stubEnv("FITRON_RAZORPAY_KEY_SECRET", "");
    try {
      // A demo payment made before the server went live (or in development) can't be confirmed there either.
      const old = await startBranchPayment(owner, "MONTHLY", fourth);
      expect(old.mode).toBe("DEMO");
      vi.stubEnv("NODE_ENV", "production");
      await expect(confirmDemoPayment(owner, old.id)).rejects.toThrow(/made online with Razorpay/);
      expect((await db.branchSubscription.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("PENDING");
      const before = await db.branchSubscription.count({ where: { orgId: gym.org.id } });
      await expect(startBranchPayment(owner, "MONTHLY", fourth)).rejects.toThrow(/aren't switched on/);
      expect(await db.branchSubscription.count({ where: { orgId: gym.org.id } })).toBe(before);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
