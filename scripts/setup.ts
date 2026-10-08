// Creates a gym, its first branch and its Super Admin. Run once per new gym:
//   npm run setup -- --gym "Power Haus Gym" --branch "City Centre" --name "Sumit Kumar" \
//     --email owner@example.com --phone 9876543210 --password 'a-long-password'
import { parseArgs } from "node:util";
import { makeClient } from "../prisma/client";
import { ensureExpenseCategories, ensureRoles } from "../prisma/roles";
import { hashPassword } from "../src/lib/auth/password";

const { values: a } = parseArgs({
  options: {
    gym: { type: "string" },
    branch: { type: "string", default: "Main" },
    address: { type: "string", default: "" },
    name: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    password: { type: "string" },
  },
});

async function main() {
  for (const k of ["gym", "name", "email", "phone", "password"] as const) {
    if (!a[k]) throw new Error(`Missing --${k}`);
  }
  if (a.password!.length < 10) throw new Error("Use a password of at least 10 characters.");
  const db = makeClient();
  const roles = await ensureRoles(db);
  await ensureExpenseCategories(db);
  const org = await db.organization.create({ data: { name: a.gym! } });
  const branch = await db.branch.create({ data: { orgId: org.id, name: a.branch!, address: a.address!, phone: a.phone! } });
  await db.setting.create({ data: { orgId: org.id, key: "gym", value: { name: a.gym } } });
  await db.user.create({
    data: {
      orgId: org.id,
      name: a.name!,
      email: a.email!.toLowerCase(),
      phone: a.phone!,
      roleId: roles.get("Super Admin")!,
      passwordHash: await hashPassword(a.password!),
      emailVerifiedAt: new Date(),
      branches: { create: [{ branchId: branch.id }] },
    },
  });
  console.log(`Created ${a.gym} with branch ${a.branch}. Sign in as ${a.email}.`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
