import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { PlanInput } from "@/lib/validation/plan";
import { audit } from "./audit";
import { UserError } from "./errors";

export async function listPlans(u: CurrentUser, opts: { activeOnly?: boolean } = {}) {
  const plans = await db.membershipPlan.findMany({
    where: { orgId: u.orgId, ...(opts.activeOnly ? { status: "ACTIVE" } : {}) },
    orderBy: [{ status: "asc" }, { months: "asc" }, { price: "asc" }],
    include: { _count: { select: { memberships: true } }, prices: true },
  });
  return plans;
}

export const getPlan = (u: CurrentUser, id: string) => db.membershipPlan.findFirst({ where: { orgId: u.orgId, id }, include: { prices: true } });

/** Splits the form into the plan's own columns and its category prices. */
function split(input: PlanInput) {
  const { femalePrice, studentPrice, malePrice, ...plan } = input;
  const prices = ([["Female", femalePrice], ["Student", studentPrice], ["Male", malePrice]] as const).filter(([, v]) => v != null && v > 0).map(([category, price]) => ({ category, price: price! }));
  return { plan, prices };
}

export async function createPlan(u: CurrentUser, input: PlanInput) {
  const { plan, prices } = split(input);
  return db.$transaction(async (tx) => {
    const p = await tx.membershipPlan.create({ data: { ...plan, orgId: u.orgId, prices: { create: prices } } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "plan.create", entity: "MembershipPlan", entityId: p.id, after: p });
    return p;
  });
}

/** Rule 8: price edits only affect new sales, because memberships and invoices keep their own prices. */
export async function updatePlan(u: CurrentUser, id: string, input: PlanInput) {
  const before = await getPlan(u, id);
  if (!before) throw new UserError("Plan not found.");
  const { plan, prices } = split(input);
  return db.$transaction(async (tx) => {
    await tx.planPrice.deleteMany({ where: { planId: id } });
    const after = await tx.membershipPlan.update({ where: { id }, data: { ...plan, prices: { create: prices } } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "plan.update", entity: "MembershipPlan", entityId: id, before, after });
    return after;
  });
}

export async function setPlanStatus(u: CurrentUser, id: string, status: "ACTIVE" | "INACTIVE") {
  const before = await getPlan(u, id);
  if (!before) throw new UserError("Plan not found.");
  await db.$transaction(async (tx) => {
    const after = await tx.membershipPlan.update({ where: { id }, data: { status } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: `plan.${status === "ACTIVE" ? "activate" : "deactivate"}`, entity: "MembershipPlan", entityId: id, before, after });
  });
}

/** Rule 8: a plan that was ever sold can only be deactivated. */
export async function deletePlan(u: CurrentUser, id: string) {
  const before = await getPlan(u, id);
  if (!before) throw new UserError("Plan not found.");
  const used = await db.membership.count({ where: { planId: id } });
  const onInvoices = await db.invoiceItem.count({ where: { planId: id } });
  if (used + onInvoices > 0) throw new UserError("This plan has been sold, so it can only be deactivated.");
  await db.$transaction(async (tx) => {
    await tx.planPrice.deleteMany({ where: { planId: id } });
    await tx.membershipPlan.delete({ where: { id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "plan.delete", entity: "MembershipPlan", entityId: id, before });
  });
}
