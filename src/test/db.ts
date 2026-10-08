import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { DEFAULT_ROLES, type Permission } from "@/lib/auth/permissions";
import { ensureExpenseCategories, ensureRoles } from "../../prisma/roles";

export const hasDb = !!process.env.DATABASE_URL;

/** A fresh gym with two branches, so tests don't see each other's data. */
export async function makeGym() {
  const roles = await ensureRoles(db);
  await ensureExpenseCategories(db);
  const org = await db.organization.create({ data: { name: `Test gym ${randomUUID().slice(0, 8)}` } });
  const a = await db.branch.create({ data: { orgId: org.id, name: "A", address: "", phone: "" } });
  const b = await db.branch.create({ data: { orgId: org.id, name: "B", address: "", phone: "" } });

  async function user(role: keyof typeof DEFAULT_ROLES, branchIds = [a.id, b.id]): Promise<CurrentUser> {
    const u = await db.user.create({
      data: {
        orgId: org.id,
        name: `${role} user`,
        email: `${randomUUID()}@test.local`,
        phone: "9000000000",
        passwordHash: "x",
        emailVerifiedAt: new Date(),
        roleId: roles.get(role)!,
        branches: { create: branchIds.map((branchId) => ({ branchId })) },
      },
    });
    const perms = new Set<string>(DEFAULT_ROLES[role]);
    const branches = [a, b].filter((x) => branchIds.includes(x.id)).map((x) => ({ id: x.id, name: x.name, active: true }));
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      photoKey: null,
      orgId: org.id,
      orgName: org.name,
      role,
      perms,
      branches,
      branch: branches.length > 1 ? "ALL" : branches[0]!.id,
      branchIds: branches.map((x) => x.id),
      can: (p: Permission) => perms.has(p),
      planBlocked: false,
      plan: { key: "professional", name: "Professional", custom: true },
      has: () => true,
    };
  }

  return { org, a, b, user };
}

export const pick = (u: CurrentUser, branchId: string): CurrentUser => ({ ...u, branch: branchId, branchIds: [branchId] });
