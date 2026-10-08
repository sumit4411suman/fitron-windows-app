import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";
import { hashPassword } from "@/lib/auth/password";
import { changeStaffRole, updateStaff } from "./staff";

describe.skipIf(!hasDb)("changeStaffRole (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let boss: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  const PW = "correct horse battery";
  const role = async (name: string) => (await db.role.findUniqueOrThrow({ where: { name } })).id;
  const audits = (action: string, entityId: string) => db.auditLog.findMany({ where: { orgId: gym.org.id, action, entityId } });

  beforeAll(async () => {
    gym = await makeGym();
    boss = await gym.user("Super Admin");
    await db.user.update({ where: { id: boss.id }, data: { passwordHash: await hashPassword(PW) } });
  });

  it("rejects a wrong password, leaves the role and audits the attempt", async () => {
    const t = await gym.user("Receptionist");
    await expect(changeStaffRole(boss, { userId: t.id, roleId: await role("Accountant"), password: "nope" })).rejects.toThrow(/Wrong password/);
    expect((await db.user.findUniqueOrThrow({ where: { id: t.id } })).roleId).toBe(await role("Receptionist"));
    expect(await audits("staff.role-password-failed", t.id)).toHaveLength(1);
  });

  it("changes the role with the right password and audits before and after", async () => {
    const t = await gym.user("Receptionist");
    const r = await changeStaffRole(boss, { userId: t.id, roleId: await role("Accountant"), password: PW });
    expect(r?.role).toBe("Accountant");
    expect((await db.user.findUniqueOrThrow({ where: { id: t.id } })).roleId).toBe(await role("Accountant"));
    const [a] = await audits("staff.role", t.id);
    expect(a!.before).toMatchObject({ role: "Receptionist" });
    expect(a!.after).toMatchObject({ role: "Accountant", passwordConfirmed: true });
  });

  it("refuses your own role and does nothing for the same role", async () => {
    await expect(changeStaffRole(boss, { userId: boss.id, roleId: await role("Admin"), password: PW })).rejects.toThrow(/your own role/);
    const t = await gym.user("Trainer");
    await changeStaffRole(boss, { userId: t.id, roleId: await role("Trainer"), password: PW });
    expect(await audits("staff.role", t.id)).toHaveLength(0);
  });

  it("keeps at least one Super Admin", async () => {
    const g = await makeGym();
    const a = await g.user("Super Admin");
    await db.user.update({ where: { id: a.id }, data: { passwordHash: await hashPassword(PW) } });
    const b = await g.user("Super Admin");
    await db.user.update({ where: { id: b.id }, data: { active: false } });
    // b is inactive, so a is the only active Super Admin; a different Super Admin cannot be the caller, so use b's rights via a
    const c = await g.user("Super Admin");
    await db.user.update({ where: { id: c.id }, data: { passwordHash: await hashPassword(PW) } });
    await db.user.update({ where: { id: c.id }, data: { active: true } });
    // Two active Super Admins (a, c): demoting a works, then c is the last.
    await changeStaffRole(c, { userId: a.id, roleId: await role("Admin"), password: PW });
    const d = await g.user("Super Admin");
    await db.user.update({ where: { id: d.id }, data: { passwordHash: await hashPassword(PW) } });
    await db.user.update({ where: { id: d.id }, data: { active: false } });
    await expect(changeStaffRole(d, { userId: c.id, roleId: await role("Admin"), password: PW })).rejects.toThrow(/Keep at least one Super Admin/);
  });

  it("lets only a Super Admin grant or change Super Admin", async () => {
    const admin = await gym.user("Admin");
    const caller = { ...admin, perms: new Set([...admin.perms, "staff.manage"]) };
    await db.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(PW) } });
    const t = await gym.user("Receptionist");
    await expect(changeStaffRole(caller, { userId: t.id, roleId: await role("Super Admin"), password: PW })).rejects.toThrow(/Only a Super Admin can make someone Super Admin/);
    const other = await gym.user("Super Admin");
    await expect(changeStaffRole(caller, { userId: other.id, roleId: await role("Admin"), password: PW })).rejects.toThrow(/Only a Super Admin can change the Super Admin account/);
  });

  it("updateStaff keeps one Super Admin too", async () => {
    const g = await makeGym();
    const only = await g.user("Super Admin");
    const other = await g.user("Super Admin");
    await db.user.update({ where: { id: other.id }, data: { active: false } });
    const caller = await g.user("Super Admin");
    await db.user.update({ where: { id: caller.id }, data: { active: false } });
    // `only` is the sole active Super Admin; an inactive Super Admin editing them cannot demote them.
    const u = await db.user.findUniqueOrThrow({ where: { id: only.id } });
    await expect(
      updateStaff(caller, only.id, { name: u.name, email: u.email, phone: u.phone, roleId: await role("Admin"), shift: null, ptRate: 0, branchIds: [g.a.id] } as never),
    ).rejects.toThrow(/Keep at least one Super Admin/);
  });
});
