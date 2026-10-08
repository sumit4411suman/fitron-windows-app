import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { codeAt, stepAt } from "@/lib/auth/totp";
import { hasDb, makeGym } from "@/test/db";
import {
  adminResetTwoStep,
  beginTwoStep,
  cancelTwoStep,
  confirmTwoStep,
  disableTwoStep,
  hashRecoveryCode,
  missingKeys,
  pendingSetup,
  regenerateRecoveryCodes,
  sealSecret,
  twoStepStatus,
  unsealSecret,
  verifySecondFactor,
} from "./two-step";

const PASSWORD = "a-long-password-123";

describe("sealing the secret", () => {
  it("round-trips, and what is stored is neither the secret nor the same twice", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP");
    expect(unsealSecret(sealed)).toBe("JBSWY3DPEHPK3PXP");
    expect(Buffer.from(sealed).toString("latin1")).not.toContain("JBSWY3DPEHPK3PXP");
    expect(Buffer.from(sealSecret("JBSWY3DPEHPK3PXP")).equals(Buffer.from(sealed))).toBe(false);
  });

  it("refuses a sealed secret that was changed", () => {
    const sealed = Buffer.from(sealSecret("JBSWY3DPEHPK3PXP"));
    sealed[sealed.length - 1]! ^= 1;
    expect(() => unsealSecret(sealed)).toThrow();
  });
});

describe.skipIf(!hasDb)("two-step sign-in (database)", () => {
  afterEach(() => vi.unstubAllEnvs());

  /** A user of a fresh gym with a known password, the setup finished, and the secret and recovery codes in hand. */
  async function enabled(role: "Super Admin" | "Admin" | "Receptionist" = "Receptionist") {
    const gym = await makeGym();
    const u = await gym.user(role);
    await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    const { secret } = await beginTwoStep(u);
    const codes = await confirmTwoStep(u, codeAt(secret, stepAt(Date.now())));
    return { gym, u, secret, codes };
  }
  const fresh = async () => {
    const gym = await makeGym();
    const u = await gym.user("Receptionist");
    await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    return { gym, u };
  };

  describe("setting up", () => {
    it("starts without asking for anything at sign-in, and shows the same secret until it is confirmed or cancelled", async () => {
      const { u } = await fresh();
      const a = await beginTwoStep(u);
      expect(a.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(a.otpauth).toContain(`secret=${a.secret}`);
      expect(a.otpauth).toContain(encodeURIComponent(u.email));
      expect((await pendingSetup(u))?.secret).toBe(a.secret);
      expect(await twoStepStatus(u.id)).toMatchObject({ enabled: false, recoveryLeft: 0 });
      // Not on yet: a code is not asked for, and none would be accepted.
      expect(await verifySecondFactor(u.id, codeAt(a.secret, stepAt(Date.now())))).toBeNull();
      await cancelTwoStep(u);
      expect(await pendingSetup(u)).toBeNull();
    });

    it("makes a new secret when started again, and the old one no longer confirms", async () => {
      const { u } = await fresh();
      const first = await beginTwoStep(u);
      const second = await beginTwoStep(u);
      expect(second.secret).not.toBe(first.secret);
      await expect(confirmTwoStep(u, codeAt(first.secret, stepAt(Date.now())))).rejects.toThrow(/not right/);
    });

    it("says what is missing, instead of failing later, on a production server without the keys it needs", async () => {
      const { u } = await fresh();
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("BIOMETRIC_KEY", "");
      vi.stubEnv("AUTH_SECRET", "");
      vi.stubEnv("CRON_SECRET", "");
      await expect(beginTwoStep(u)).rejects.toThrow(/no BIOMETRIC_KEY or AUTH_SECRET set/);
      vi.stubEnv("BIOMETRIC_KEY", "a-key-for-this-test");
      await expect(beginTwoStep(u)).rejects.toThrow(/no AUTH_SECRET set/);
      vi.stubEnv("CRON_SECRET", "falls-back-to-this");
      expect(missingKeys()).toEqual([]);
      expect((await beginTwoStep(u)).secret).toMatch(/^[A-Z2-7]{32}$/);
    });

    it("does not turn on for a wrong code, and says which field", async () => {
      const { u } = await fresh();
      await beginTwoStep(u);
      await expect(confirmTwoStep(u, "000000")).rejects.toMatchObject({ field: "code" });
      expect((await twoStepStatus(u.id)).enabled).toBe(false);
    });

    it("needs setup to have been started", async () => {
      const { u } = await fresh();
      await expect(confirmTwoStep(u, "123456")).rejects.toThrow(/Start the setup again/);
    });

    it("turns on with the right code and gives ten recovery codes, once", async () => {
      const { u } = await fresh();
      const { secret } = await beginTwoStep(u);
      const codes = await confirmTwoStep(u, codeAt(secret, stepAt(Date.now())));
      expect(codes).toHaveLength(10);
      expect(await twoStepStatus(u.id)).toMatchObject({ enabled: true, recoveryLeft: 10 });
      expect(await pendingSetup(u)).toBeNull();
      await expect(beginTwoStep(u)).rejects.toThrow(/already on/);
      await expect(confirmTwoStep(u, codeAt(secret, stepAt(Date.now())))).rejects.toThrow(/already on/);
      const audited = await db.auditLog.findMany({ where: { entityId: u.id, action: "auth.two-step-on" } });
      expect(audited).toHaveLength(1);
    });

    it("keeps the secret sealed and only hashes of the recovery codes", async () => {
      const { u, secret, codes } = await enabled();
      const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpSecret: true } });
      expect(Buffer.from(row.totpSecret!).toString("latin1")).not.toContain(secret);
      expect(unsealSecret(row.totpSecret!)).toBe(secret);
      const stored = (await db.recoveryCode.findMany({ where: { userId: u.id } })).map((r) => r.codeHash);
      expect(stored.sort()).toEqual(codes.map((c) => hashRecoveryCode(c.replace("-", ""))).sort());
      for (const c of codes) expect(stored.join()).not.toContain(c.replace("-", ""));
    });

    it("does not let the code used to turn it on be used to sign in again", async () => {
      const { u, secret } = await enabled();
      expect(await verifySecondFactor(u.id, codeAt(secret, stepAt(Date.now())))).toBeNull();
    });
  });

  describe("the second step of a sign-in", () => {
    it("accepts the next code, once", async () => {
      const { u, secret } = await enabled();
      const later = Date.now() + 90_000;
      const code = codeAt(secret, stepAt(later));
      expect(await verifySecondFactor(u.id, code, later)).toBe("code");
      expect(await verifySecondFactor(u.id, code, later)).toBeNull();
    });

    it("refuses an older code than the last one used, and one that is wrong", async () => {
      const { u, secret } = await enabled();
      const later = Date.now() + 120_000;
      expect(await verifySecondFactor(u.id, codeAt(secret, stepAt(later)), later)).toBe("code");
      expect(await verifySecondFactor(u.id, codeAt(secret, stepAt(later) - 1), later)).toBeNull();
      expect(await verifySecondFactor(u.id, "000000", later + 30_000)).toBeNull();
      expect(await verifySecondFactor(u.id, "", later)).toBeNull();
    });

    it("lets only one of two sign-ins that use the same code at the same moment succeed", async () => {
      const { u, secret } = await enabled();
      const later = Date.now() + 150_000;
      const code = codeAt(secret, stepAt(later));
      const results = await Promise.all(Array.from({ length: 6 }, () => verifySecondFactor(u.id, code, later)));
      expect(results.filter((r) => r === "code")).toHaveLength(1);
    });

    it("accepts a recovery code once, however it is typed, and counts it as used", async () => {
      const { u, codes } = await enabled();
      const typed = ` ${codes[0]!.toLowerCase().replace("-", " ")} `;
      expect(await verifySecondFactor(u.id, typed)).toBe("recovery");
      expect(await verifySecondFactor(u.id, codes[0]!)).toBeNull();
      expect(await twoStepStatus(u.id)).toMatchObject({ recoveryLeft: 9 });
      expect(await verifySecondFactor(u.id, codes[1]!)).toBe("recovery");
    });

    it("refuses a recovery code of someone else, and a made-up one", async () => {
      const a = await enabled();
      const b = await enabled();
      expect(await verifySecondFactor(b.u.id, a.codes[0]!)).toBeNull();
      expect(await verifySecondFactor(a.u.id, "ABCDE-FGHJK")).toBeNull();
    });

    it("asks nothing of someone who has not turned it on", async () => {
      const { u } = await fresh();
      expect(await verifySecondFactor(u.id, "123456")).toBeNull();
      expect(await verifySecondFactor(randomUUID(), "123456")).toBeNull();
    });
  });

  describe("turning it off", () => {
    it("needs the password and a code, and clears everything", async () => {
      const { u, secret, codes } = await enabled();
      await expect(disableTwoStep(u, { password: "wrong-password", code: codes[0]! })).rejects.toMatchObject({ field: "password" });
      await expect(disableTwoStep(u, { password: PASSWORD, code: "000000" })).rejects.toMatchObject({ field: "code" });
      expect((await twoStepStatus(u.id)).enabled).toBe(true);
      // The next 30-second step's code is accepted (a phone clock a little ahead) and has not been used.
      await disableTwoStep(u, { password: PASSWORD, code: codeAt(secret, stepAt(Date.now()) + 1) });
      expect(await twoStepStatus(u.id)).toEqual({ enabled: false, enabledAt: null, recoveryLeft: 0 });
      const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpSecret: true, totpLastStep: true } });
      expect(row).toEqual({ totpSecret: null, totpLastStep: null });
      expect(await db.recoveryCode.count({ where: { userId: u.id } })).toBe(0);
      expect(await db.auditLog.count({ where: { entityId: u.id, action: "auth.two-step-off" } })).toBe(1);
    });

    it("says so when it is not on", async () => {
      const { u } = await fresh();
      await expect(disableTwoStep(u, { password: PASSWORD, code: "123456" })).rejects.toThrow(/not on/);
    });
  });

  describe("recovery codes", () => {
    it("are replaced by ten new ones when asked for with the password; the old ones stop working", async () => {
      const { u, codes } = await enabled();
      await expect(regenerateRecoveryCodes(u, { password: "wrong-password" })).rejects.toMatchObject({ field: "password" });
      const fresh10 = await regenerateRecoveryCodes(u, { password: PASSWORD });
      expect(fresh10).toHaveLength(10);
      expect(fresh10.some((c) => codes.includes(c))).toBe(false);
      expect(await verifySecondFactor(u.id, codes[0]!)).toBeNull();
      expect(await verifySecondFactor(u.id, fresh10[0]!)).toBe("recovery");
      expect(await db.auditLog.count({ where: { entityId: u.id, action: "auth.recovery-codes-new" } })).toBe(1);
    });
  });

  describe("a Super Admin or Admin turning it off for someone who lost their phone", () => {
    it("clears it, signs the person out everywhere and audits who did it", async () => {
      const { gym, u: target } = await enabled();
      const admin = await gym.user("Admin");
      await db.session.create({ data: { id: `s-${randomUUID()}`, userId: target.id, expiresAt: new Date(Date.now() + 86_400_000) } });
      await adminResetTwoStep(admin, target.id);
      expect((await twoStepStatus(target.id)).enabled).toBe(false);
      expect(await db.recoveryCode.count({ where: { userId: target.id } })).toBe(0);
      expect(await db.session.count({ where: { userId: target.id } })).toBe(0);
      const a = await db.auditLog.findFirstOrThrow({ where: { entityId: target.id, action: "auth.two-step-reset" } });
      expect(a.userId).toBe(admin.id);
    });

    it("refuses someone outside the gym, themselves, and someone who does not use it", async () => {
      const { gym, u: target } = await enabled();
      const admin = await gym.user("Admin");
      const outsider = await (await makeGym()).user("Super Admin");
      await expect(adminResetTwoStep(outsider, target.id)).rejects.toThrow(/not on your team/);
      await expect(adminResetTwoStep(admin, admin.id)).rejects.toThrow(/My profile/);
      const plain = await gym.user("Trainer");
      await expect(adminResetTwoStep(admin, plain.id)).rejects.toThrow(/does not use/);
      expect((await twoStepStatus(target.id)).enabled).toBe(true);
    });

    it("lets only a Super Admin reset a Super Admin", async () => {
      const { gym, u: boss } = await enabled("Super Admin");
      const admin = await gym.user("Admin");
      await expect(adminResetTwoStep(admin, boss.id)).rejects.toThrow(/Only a Super Admin/);
      const other = await gym.user("Super Admin");
      await adminResetTwoStep(other, boss.id);
      expect((await twoStepStatus(boss.id)).enabled).toBe(false);
    });
  });
});
