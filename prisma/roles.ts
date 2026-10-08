import type { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_ROLES, PERMISSIONS } from "../src/lib/auth/permissions";

/** Creates any missing permissions and default roles. Safe to run repeatedly; never removes a grant. */
export async function ensureRoles(db: PrismaClient) {
  for (const key of Object.keys(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, create: { key }, update: {} });
  }
  const perms = new Map((await db.permission.findMany()).map((p) => [p.key, p.id]));
  const roles = new Map<string, string>();
  for (const [name, keys] of Object.entries(DEFAULT_ROLES)) {
    const role = await db.role.upsert({ where: { name }, create: { name }, update: {} });
    roles.set(name, role.id);
    await db.rolePermission.createMany({
      data: keys.map((k) => ({ roleId: role.id, permissionId: perms.get(k)! })),
      skipDuplicates: true,
    });
  }
  return roles;
}

export const EXPENSE_CATEGORIES: [string, string][] = [
  ["Rent", "Rent"],
  ["Electricity", "Utilities"],
  ["Water", "Utilities"],
  ["Internet", "Utilities"],
  ["Staff Salary", "Salaries"],
  ["Trainer Salary", "Salaries"],
  ["Equipment Purchase", "Equipment"],
  ["Equipment Maintenance", "Maintenance"],
  ["Repairs", "Maintenance"],
  ["Cleaning", "Operating"],
  ["Software", "Operating"],
  ["Office Expenses", "Operating"],
  ["Marketing", "Marketing"],
  ["Advertising", "Marketing"],
  ["Inventory", "Inventory"],
  ["Miscellaneous", "Other"],
];

/** Shared expense categories, keyed by a stable slug. */
export async function ensureExpenseCategories(db: PrismaClient) {
  for (const [name, group] of EXPENSE_CATEGORIES) {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await db.expenseCategory.upsert({ where: { id }, create: { id, name, group }, update: { name, group } });
  }
}
