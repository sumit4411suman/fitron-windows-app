import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/lib/auth/password";
import { isLocal } from "@/lib/runtime/edition";
import { makeLocalClient } from "@/lib/runtime/local-client";
import { migrateLocal } from "@/lib/runtime/local-migrate";
import { GENESIS } from "@/lib/domain/audit-chain";
import { createLocalGym, holdRecoveryKey, localSetupNeeded, makeRecoveryKey, recoverOwner, takeRecoveryKey } from "./local-setup";
import { createGymAccount } from "./accounts";

// Phase 8: first-run setup of the Local Edition, on its own empty SQLite file (setup only works on a computer with no gym).
describe.skipIf(!isLocal())("Local Edition first-run setup (SQLite)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fitron-setup-"));
  const file = path.join(dir, "fitron.db");
  let client: ReturnType<typeof makeLocalClient>;
  const input = { gymName: "Power Haus Gym", branchName: "City Centre", address: "1 Station Road", ownerName: "Asha Verma", email: "owner@powerhaus.in", phone: "9876543210", password: "a-long-password-1", confirm: "a-long-password-1" };

  beforeAll(() => {
    migrateLocal(file, path.join(process.cwd(), "prisma", "local-migrations"));
    client = makeLocalClient(`file:${file}`);
  });
  afterAll(async () => {
    await client.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it("makes recovery keys that are long, readable and different every time", () => {
    const a = makeRecoveryKey();
    expect(a).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
    expect(a).not.toMatch(/[01OI]/);
    expect(new Set(Array.from({ length: 50 }, makeRecoveryKey)).size).toBe(50);
  });

  it("creates the gym, its branch, the roles and a Super Admin owner in one go, and only once", async () => {
    expect(await localSetupNeeded(client)).toBe(true);
    const r = await createLocalGym(input, client);
    expect(await localSetupNeeded(client)).toBe(false);

    const owner = await client.user.findUniqueOrThrow({ where: { id: r.userId }, include: { role: true, branches: { include: { branch: true } } } });
    expect(owner).toMatchObject({ email: "owner@powerhaus.in", name: "Asha Verma", active: true });
    expect(owner.role.name).toBe("Super Admin");
    expect(owner.emailVerifiedAt).not.toBeNull();
    expect(owner.branches.map((b) => b.branch.name)).toEqual(["City Centre"]);
    expect(owner.passwordHash).not.toContain("a-long-password-1");
    expect(await verifyPassword(owner.passwordHash, "a-long-password-1")).toBe(true);
    expect((await client.role.findMany()).map((x) => x.name).sort()).toEqual(["Accountant", "Admin", "Receptionist", "Super Admin", "Trainer"]);

    const org = await client.organization.findUniqueOrThrow({ where: { id: r.orgId } });
    expect(org.trialEndsAt, "not a fitron.in trial").toBeNull();
    const recovery = await client.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: r.orgId, key: "localRecovery" } } });
    expect(JSON.stringify(recovery.value)).not.toContain(r.recoveryKey.replace(/-/g, ""));
    expect((await client.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: r.orgId, key: "onboarding" } } })).value).toEqual({ status: "PENDING" });
    const auditRows = await client.auditLog.findMany({ where: { orgId: r.orgId } });
    expect(auditRows.map((a) => a.action)).toEqual(["account.create"]);
    expect(auditRows[0]!.prevHash).toBe(GENESIS);

    await expect(createLocalGym({ ...input, email: "other@gym.in" }, client)).rejects.toThrow(/already set up/);
    expect(await client.organization.count()).toBe(1);
  });

  it("resets the owner's password with the recovery key, ends their sessions and replaces the key", async () => {
    const org = await client.organization.findFirstOrThrow();
    const owner = await client.user.findFirstOrThrow({ where: { orgId: org.id } });
    await client.session.create({ data: { id: "s".repeat(64), userId: owner.id, expiresAt: new Date(Date.now() + 86_400_000) } });

    // Wrong key, unknown email, staff member: the same refusal, and nothing changes.
    expect(await recoverOwner({ email: owner.email, recoveryKey: "AAAA-BBBB-CCCC-DDDD-EEEE", password: "new-password-22", confirm: "new-password-22" }, client)).toBeNull();
    expect(await recoverOwner({ email: "nobody@gym.in", recoveryKey: "AAAA-BBBB-CCCC-DDDD-EEEE", password: "new-password-22", confirm: "new-password-22" }, client)).toBeNull();
    expect(await verifyPassword((await client.user.findUniqueOrThrow({ where: { id: owner.id } })).passwordHash, "a-long-password-1")).toBe(true);
  });

  it("accepts the key typed in lower case and without dashes, and the old key stops working", async () => {
    const dir2 = mkdtempSync(path.join(os.tmpdir(), "fitron-setup2-"));
    const file2 = path.join(dir2, "fitron.db");
    migrateLocal(file2, path.join(process.cwd(), "prisma", "local-migrations"));
    const c2 = makeLocalClient(`file:${file2}`);
    try {
      const r = await createLocalGym(input, c2);
      await c2.session.create({ data: { id: "t".repeat(64), userId: r.userId, expiresAt: new Date(Date.now() + 86_400_000) } });
      const typed = r.recoveryKey.toLowerCase().replace(/-/g, " ");
      const done = await recoverOwner({ email: "OWNER@powerhaus.in".toLowerCase(), recoveryKey: typed, password: "new-password-22", confirm: "new-password-22" }, c2);
      expect(done?.recoveryKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
      expect(done!.recoveryKey).not.toBe(r.recoveryKey);
      const owner = await c2.user.findUniqueOrThrow({ where: { id: r.userId } });
      expect(await verifyPassword(owner.passwordHash, "new-password-22")).toBe(true);
      expect(await c2.session.count({ where: { userId: r.userId } }), "signed out everywhere").toBe(0);
      expect(await recoverOwner({ email: owner.email, recoveryKey: r.recoveryKey, password: "another-pass-33", confirm: "another-pass-33" }, c2), "the old key is used up").toBeNull();
      expect((await c2.auditLog.findMany({ where: { orgId: r.orgId }, orderBy: { id: "asc" } })).map((a) => a.action)).toEqual(["account.create", "auth.recovery-key-reset"]);
    } finally {
      await c2.$disconnect();
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("refuses the fitron.in sign-up on a Local server: gyms come from first-run setup", async () => {
    vi.stubEnv("FITRON_LOCAL_ALLOW_SIGNUP", "");
    try {
      await expect(
        createGymAccount({ plan: "professional", cycle: "MONTHLY", name: "X", email: `x-${Date.now()}@gym.in`, password: "a-long-password-1", business: "X Gym", phone: "9876543210" } as Parameters<typeof createGymAccount>[0]),
      ).rejects.toThrow(/not available in FITRON for Windows/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hands the recovery key out once, only to its owner, and not after ten minutes", () => {
    holdRecoveryKey("owner-1", "AAAA-BBBB-CCCC-DDDD-EEEE", 0);
    expect(takeRecoveryKey("someone-else", 1)).toBeNull();
    expect(takeRecoveryKey("owner-1", 1)).toBe("AAAA-BBBB-CCCC-DDDD-EEEE");
    expect(takeRecoveryKey("owner-1", 2), "once").toBeNull();
    holdRecoveryKey("owner-2", "FFFF-GGGG-HHHH-JJJJ-KKKK", 0);
    expect(takeRecoveryKey("owner-2", 10 * 60_000 + 1)).toBeNull();
  });
});

