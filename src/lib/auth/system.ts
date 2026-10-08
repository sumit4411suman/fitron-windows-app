import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "./current";
import { PERMISSIONS, type Permission } from "./permissions";

/**
 * The identity scheduled jobs and webhooks act as: every permission, every branch of one gym.
 * Records need a staff id (createdById), so it borrows `actAs` (e.g. whoever set up an autopay
 * mandate) or else the gym's first Super Admin; audit rows say the action was automatic.
 */
export async function systemUser(orgId: string, actAs?: string): Promise<CurrentUser> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, include: { branches: { select: { id: true, name: true, active: true }, orderBy: { createdAt: "asc" } } } });
  const owner =
    (actAs && (await db.user.findFirst({ where: { id: actAs, orgId }, select: { id: true } }))) ||
    (await db.user.findFirst({ where: { orgId, role: { name: "Super Admin" } }, orderBy: { createdAt: "asc" }, select: { id: true } })) ||
    (await db.user.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: "asc" }, select: { id: true } }));
  const perms = new Set<string>(Object.keys(PERMISSIONS));
  return {
    id: owner.id,
    name: "Fitron (automatic)",
    email: "",
    photoKey: null,
    orgId,
    orgName: org.name,
    role: "System",
    perms,
    branches: org.branches,
    branch: "ALL",
    branchIds: org.branches.map((b) => b.id),
    can: (p: Permission) => perms.has(p),
    // Automatic jobs (renewals, webhooks) keep running; the plan only gates people.
    planBlocked: false,
    plan: { key: org.plan, name: org.plan, custom: true },
    has: () => true,
  };
}
