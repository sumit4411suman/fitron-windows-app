import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { Prisma } from "@/generated/prisma/client";
import type { StaffInput } from "@/lib/validation/staff";
import { audit } from "./audit";
import { isUniqueViolation, UserError } from "./errors";

const safe = <T extends { passwordHash?: string }>(u: T) => {
  const { passwordHash: _, ...rest } = u;
  void _;
  return rest;
};

export const listStaff = (u: CurrentUser) =>
  db.user.findMany({
    where: { orgId: u.orgId, deletedAt: null },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      shift: true,
      ptRate: true,
      salary: true,
      joinedOn: true,
      payAccount: true,
      active: true,
      lastLoginAt: true,
      totpEnabledAt: true,
      role: { select: { id: true, name: true } },
      branches: { select: { branch: { select: { id: true, name: true } } } },
    },
  });

export const listTrainers = (u: CurrentUser) =>
  db.user.findMany({
    where: { orgId: u.orgId, deletedAt: null, active: true, role: { name: "Trainer" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

export const listRoles = () =>
  db.role.findMany({ orderBy: { name: "asc" }, include: { permissions: { include: { permission: true } } } });

export async function getStaff(u: CurrentUser, id: string) {
  return db.user.findFirst({
    where: { orgId: u.orgId, id, deletedAt: null },
    select: { id: true, name: true, email: true, phone: true, shift: true, ptRate: true, active: true, roleId: true, branches: { select: { branchId: true } } },
  });
}

/** Only open branches can be newly assigned; `keep` are ones the person already has, even if closed since. */
async function checkBranches(u: CurrentUser, ids: string[], keep: string[] = []) {
  const n = await db.branch.count({ where: { orgId: u.orgId, id: { in: ids }, OR: [{ active: true }, { id: { in: keep } }] } });
  if (n !== ids.length) throw new UserError("Pick branches from this gym.", "branchIds");
}

export async function createStaff(u: CurrentUser, input: StaffInput) {
  if (!input.password) throw new UserError("Set a first password.", "password");
  await checkBranches(u, input.branchIds);
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          orgId: u.orgId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          roleId: input.roleId,
          shift: input.shift ?? null,
          ptRate: input.ptRate,
          passwordHash,
          // The admin who adds a colleague vouches for the address; they can sign in straight away.
          emailVerifiedAt: new Date(),
          branches: { create: input.branchIds.map((branchId) => ({ branchId })) },
        },
      });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "staff.create", entity: "User", entityId: user.id, after: safe(user) });
      return user;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("Someone already uses this email.", "email");
    throw e;
  }
}

export async function updateStaff(u: CurrentUser, id: string, input: StaffInput) {
  const before = await db.user.findFirst({ where: { orgId: u.orgId, id, deletedAt: null } });
  if (!before) throw new UserError("Staff member not found.");
  const held = (await db.userBranch.findMany({ where: { userId: id }, select: { branchId: true } })).map((x) => x.branchId);
  await checkBranches(u, input.branchIds, held);
  if (id === u.id && input.roleId !== before.roleId) throw new UserError("You can't change your own role.", "roleId");
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  try {
    await db.$transaction(async (tx) => {
      if (input.roleId !== before.roleId) await assertRoleChangeAllowed(tx, u, before, input.roleId);
      const after = await tx.user.update({
        where: { id },
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          roleId: input.roleId,
          shift: input.shift ?? null,
          ptRate: input.ptRate,
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      await tx.userBranch.deleteMany({ where: { userId: id } });
      await tx.userBranch.createMany({ data: input.branchIds.map((branchId) => ({ userId: id, branchId })) });
      // A password reset signs the person out everywhere.
      if (passwordHash) await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: input.roleId !== before.roleId ? "staff.role" : "staff.update", entity: "User", entityId: id, before: safe(before), after: { ...safe(after), branchIds: input.branchIds, passwordReset: !!passwordHash } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("Someone already uses this email.", "email");
    throw e;
  }
}

export async function setStaffActive(u: CurrentUser, id: string, active: boolean) {
  if (id === u.id) throw new UserError("You can't deactivate yourself.");
  const before = await db.user.findFirst({ where: { orgId: u.orgId, id, deletedAt: null } });
  if (!before) throw new UserError("Staff member not found.");
  await db.$transaction(async (tx) => {
    const after = await tx.user.update({ where: { id }, data: { active } });
    if (!active) await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: active ? "staff.activate" : "staff.deactivate", entity: "User", entityId: id, before: safe(before), after: safe(after) });
  });
}

const SUPER = "Super Admin";

/** Shared by Edit & role and Roles & access: only a Super Admin touches Super Admin, and the gym always keeps one. */
export async function assertRoleChangeAllowed(tx: Prisma.TransactionClient, u: CurrentUser, target: { id: string; orgId: string; roleId: string }, newRoleId: string) {
  const [oldRole, newRole] = await Promise.all([tx.role.findUnique({ where: { id: target.roleId } }), tx.role.findUnique({ where: { id: newRoleId } })]);
  if (!newRole) throw new UserError("Pick a role.", "roleId");
  const callerSuper = u.role === SUPER;
  if (oldRole?.name === SUPER && !callerSuper) throw new UserError("Only a Super Admin can change the Super Admin account.", "roleId");
  if (newRole.name === SUPER && !callerSuper) throw new UserError("Only a Super Admin can make someone Super Admin.", "roleId");
  if (oldRole?.name === SUPER && newRole.name !== SUPER) {
    const n = await tx.user.count({ where: { orgId: target.orgId, active: true, deletedAt: null, role: { name: SUPER } } });
    if (n < 2) throw new UserError("Keep at least one Super Admin.", "roleId");
  }
  return { oldRole: oldRole!.name, newRole: newRole.name };
}

/** Roles & access: change one person's role after re-entering the caller's password. Applies on their next request. */
export async function changeStaffRole(u: CurrentUser, input: { userId: string; roleId: string; password: string }) {
  const target = await db.user.findFirst({ where: { orgId: u.orgId, id: input.userId, deletedAt: null }, include: { role: true } });
  if (!target) throw new UserError("Staff member not found.");
  const role = await db.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new UserError("Pick a role.");
  if (role.id === target.roleId) return null;
  if (target.id === u.id) throw new UserError("You can't change your own role.");
  const me = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(me.passwordHash, input.password))) {
    await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "staff.role-password-failed", entity: "User", entityId: target.id, after: { name: target.name } }));
    throw new UserError("Wrong password. Use Forgot password on the sign-in screen if you don’t remember it.");
  }
  await db.$transaction(async (tx) => {
    await assertRoleChangeAllowed(tx, u, target, role.id);
    await tx.user.update({ where: { id: target.id }, data: { roleId: role.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "staff.role", entity: "User", entityId: target.id, before: { roleId: target.roleId, role: target.role.name }, after: { roleId: role.id, role: role.name, passwordConfirmed: true } });
  });
  return { name: target.name, role: role.name };
}
