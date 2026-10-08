import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hasDb } from "@/test/db";
import { verifyPassword } from "@/lib/auth/password";
import { readGymLogo } from "./gym-logo";
import { deleteObject } from "@/lib/integrations/storage";

const sent: { to: string; text: string }[] = [];
let smtp = true;
vi.mock("@/lib/integrations/email", () => ({
  emailReady: () => smtp,
  sendEmail: async (m: { to: string; text: string }) => {
    sent.push(m);
    return { sent: true };
  },
}));

const { recordSignIn, createGymAccount, requestPasswordReset, resetPassword, resetPasswordWithCode, verifyEmailWithCode, requestSignInLink, redeemSignInLink, redeemSignInCode, verifyEmail, resendVerification } = await import("./accounts");

const linkToken = (text: string, path: string) => new URL(text.match(new RegExp(`https?://\\S+${path}\\?token=\\S+`))![0]).searchParams.get("token")!;
const codeIn = (text: string) => text.match(/code[^\n]*: (\d{6})/)![1]!;
const signup = (email: string) => ({ plan: "starter", cycle: "YEARLY" as const, name: "Owner One", email, phone: "9876543210", business: "Iron Den", city: "Pune", password: "a-long-password" });

describe.skipIf(!hasDb)("Gym self sign-up (database)", () => {
  beforeEach(() => {
    sent.length = 0;
    smtp = true;
  });

  it("creates the gym on a trial, emails a link, and verifies once", async () => {
    const email = `${randomUUID()}@gym.test`;
    const { user, verified } = await createGymAccount(signup(email));
    expect(verified).toBe(false);
    const org = await db.organization.findUniqueOrThrow({ where: { id: user.orgId }, include: { branches: true, users: { include: { role: true } } } });
    expect(org).toMatchObject({ name: "Iron Den", plan: "starter", planCycle: "YEARLY" });
    expect(Math.round((org.trialEndsAt!.getTime() - Date.now()) / 86_400_000)).toBe(7);
    expect(org.branches.map((b) => b.name)).toEqual(["Main"]);
    expect(org.users[0]!.role.name).toBe("Super Admin");
    expect(user.emailVerifiedAt).toBeNull();

    await expect(createGymAccount(signup(email))).rejects.toThrow(/already an account/);

    expect(sent).toHaveLength(1);
    const token = linkToken(sent[0]!.text, "/verify-email");
    expect((await verifyEmail(token))?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await verifyEmail(token)).toBeNull();
    await resendVerification(email);
    expect(sent).toHaveLength(1);
  });

  it("confirms the address with the emailed code too, once, and the code kills the link", async () => {
    const email = `${randomUUID()}@gym.test`;
    await createGymAccount(signup(email));
    const code = codeIn(sent[0]!.text);
    expect(sent[0]!.text).toContain("/verify-email?token=");
    const wrong = code === "000000" ? "000001" : "000000";
    expect(await verifyEmailWithCode(email, wrong)).toBeNull();
    expect((await verifyEmailWithCode(email, code))?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await verifyEmailWithCode(email, code)).toBeNull();
    expect(await verifyEmail(linkToken(sent[0]!.text, "/verify-email"))).toBeNull();
    // A reset or sign-in code is not a verification code.
    const other = `${randomUUID()}@gym.test`;
    await createGymAccount(signup(other));
    await requestPasswordReset(other);
    expect(await verifyEmailWithCode(other, codeIn(sent[sent.length - 1]!.text))).toBeNull();
  });

  it("trusts the address when no email service is set up", async () => {
    smtp = false;
    const { user, verified } = await createGymAccount(signup(`${randomUUID()}@gym.test`));
    expect(verified).toBe(true);
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(sent).toHaveLength(0);
  });

  it("stores the gym profile, legal consent and an audit row at sign-up", async () => {
    smtp = false;
    const email = `${randomUUID()}@gym.test`;
    const { user } = await createGymAccount({ ...signup(email), gymEmail: "hello@iron.test", address: "Shop 4", city: "Bokaro", state: "Jharkhand", pin: "827004", tagline: "Built Stronger", website: "iron.test", instagram: "@iron" });
    const get = async (key: string) => (await db.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: user.orgId, key } } })).value as Record<string, unknown>;
    expect(await get("gym")).toEqual({ name: "Iron Den", phone: "9876543210", email: "hello@iron.test", address: "Shop 4", city: "Bokaro", state: "Jharkhand", pin: "827004", tagline: "Built Stronger", website: "iron.test", instagram: "@iron" });
    expect((await db.branch.findFirstOrThrow({ where: { orgId: user.orgId } })).address).toBe("Shop 4, Bokaro, 827004");
    const legal = await get("legal");
    expect(legal).toMatchObject({ tos: "v1", privacy: "v1", dpa: "v1", marketing: false, by: email });
    expect(Number.isNaN(Date.parse(legal.at as string))).toBe(false);
    const row = await db.auditLog.findFirstOrThrow({ where: { orgId: user.orgId, action: "account.create", entity: "Organization" } });
    expect(row.userId).toBe(user.id);
    expect((row.after as { plan: string }).plan).toBe("starter");
  });

  it("keeps working without profile fields", async () => {
    smtp = false;
    const { user } = await createGymAccount(signup(`${randomUUID()}@gym.test`));
    const gym = (await db.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: user.orgId, key: "gym" } } })).value;
    expect(gym).toEqual({ name: "Iron Den", phone: "9876543210", city: "Pune" });
    expect(await db.setting.findUnique({ where: { orgId_key: { orgId: user.orgId, key: "legal" } } })).not.toBeNull();
  });

  it("accepts a PNG logo and refuses SVG or >1 MB", async () => {
    smtp = false;
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "l.png", { type: "image/png" });
    const { user } = await createGymAccount({ ...signup(`${randomUUID()}@gym.test`), logo: png });
    const gym = (await db.setting.findUniqueOrThrow({ where: { orgId_key: { orgId: user.orgId, key: "gym" } } })).value as { logoKey?: string };
    expect(gym.logoKey).toBeTruthy();
    expect((await readGymLogo(user.orgId))?.mime).toBe("image/png");
    await deleteObject(gym.logoKey!).catch(() => {});
    const big = new File([new Uint8Array(1_048_577)], "b.png");
    await expect(createGymAccount({ ...signup(`${randomUUID()}@gym.test`), logo: big })).rejects.toThrow("Logo must be under 1 MB.");
    const svg = new File([new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")], "l.svg");
    await expect(createGymAccount({ ...signup(`${randomUUID()}@gym.test`), logo: svg })).rejects.toThrow("Use a PNG or JPG logo.");
  });

  it("recordSignIn sets lastLoginAt and writes auth.login", async () => {
    smtp = false;
    const { user } = await createGymAccount(signup(`${randomUUID()}@gym.test`));
    await recordSignIn(user.id, "google");
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(Date.now() - u.lastLoginAt!.getTime()).toBeLessThan(5000);
    const row = await db.auditLog.findFirstOrThrow({ where: { orgId: user.orgId, action: "auth.login" } });
    expect(row).toMatchObject({ userId: user.id });
    expect((row.after as { via: string }).via).toBe("google");
  });

  it("refuses non-gym plans", async () => {
    await expect(createGymAccount({ ...signup(`${randomUUID()}@gym.test`), plan: "ai-pro" })).rejects.toThrow(/Gym Accounting plan/);
  });

  it("resets a password once, signs out everywhere, and ignores unknown emails", async () => {
    const email = `${randomUUID()}@gym.test`;
    const { user } = await createGymAccount(signup(email));
    await db.session.create({ data: { id: randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    sent.length = 0;
    await requestPasswordReset("nobody@nowhere.test");
    expect(sent).toHaveLength(0);
    await requestPasswordReset(email);
    await requestPasswordReset(email);
    const [first, second] = sent.map((m) => linkToken(m.text, "/reset-password"));
    await expect(resetPassword(first!, "another-long-password")).rejects.toThrow(/expired or was already used/);
    await resetPassword(second!, "another-long-password");
    await expect(resetPassword(second!, "third-long-password")).rejects.toThrow(/expired/);
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(after.passwordHash, "another-long-password")).toBe(true);
    expect(after.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });
  it("resets a password with the emailed code, once, and not with a wrong or an old one", async () => {
    const email = `${randomUUID()}@gym.test`;
    const { user } = await createGymAccount(signup(email));
    await db.session.create({ data: { id: randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    sent.length = 0;
    await requestPasswordReset(email);
    await requestPasswordReset(email);
    const [old, code] = sent.map((m) => codeIn(m.text));
    expect(sent[1]!.text).toContain("/reset-password?token=");
    const wrong = code === "000000" ? "000001" : "000000";
    await expect(resetPasswordWithCode(email, wrong, "another-long-password")).rejects.toThrow(/not right/);
    if (old !== code) await expect(resetPasswordWithCode(email, old!, "another-long-password")).rejects.toThrow(/not right/);
    await expect(resetPasswordWithCode("nobody@nowhere.test", code!, "another-long-password")).rejects.toThrow(/not right/);
    await resetPasswordWithCode(email, ` ${code!.slice(0, 3)} ${code!.slice(3)}`.replace(/\s/g, ""), "another-long-password");
    await expect(resetPasswordWithCode(email, code!, "third-long-password")).rejects.toThrow(/not right/);
    expect(await verifyPassword((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, "another-long-password")).toBe(true);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("uses up the link when its code is used, and the code when its link is used", async () => {
    const email = `${randomUUID()}@gym.test`;
    await createGymAccount(signup(email));
    sent.length = 0;
    await requestPasswordReset(email);
    await resetPasswordWithCode(email, codeIn(sent[0]!.text), "another-long-password");
    await expect(resetPassword(linkToken(sent[0]!.text, "/reset-password"), "third-long-password")).rejects.toThrow(/expired/);
    sent.length = 0;
    await requestPasswordReset(email);
    await resetPassword(linkToken(sent[0]!.text, "/reset-password"), "third-long-password");
    await expect(resetPasswordWithCode(email, codeIn(sent[0]!.text), "fourth-long-password")).rejects.toThrow(/not right/);
  });

  it("stops accepting a code after five wrong tries, even the right one", async () => {
    const email = `${randomUUID()}@gym.test`;
    await createGymAccount(signup(email));
    sent.length = 0;
    await requestSignInLink(email);
    const code = codeIn(sent[0]!.text);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) expect(await redeemSignInCode(email, wrong)).toBeNull();
    expect(await redeemSignInCode(email, code)).toBeNull();
  });

  it("signs in by code or by link once each, confirming the address, and ignores unknown or switched-off accounts", async () => {
    const email = `${randomUUID()}@gym.test`;
    const { user } = await createGymAccount(signup(email));
    expect(user.emailVerifiedAt).toBeNull();
    sent.length = 0;
    await requestSignInLink("nobody@nowhere.test");
    expect(sent).toHaveLength(0);

    await requestSignInLink(email);
    expect(sent[0]!.text).toMatch(/\/login\/email\?token=/);
    expect((await redeemSignInCode(email, codeIn(sent[0]!.text)))?.id).toBe(user.id);
    expect(await redeemSignInCode(email, codeIn(sent[0]!.text))).toBeNull();
    expect(await redeemSignInLink(linkToken(sent[0]!.text, "/login/email"))).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeInstanceOf(Date);

    await requestSignInLink(email);
    const token = linkToken(sent[1]!.text, "/login/email");
    expect((await redeemSignInLink(token))?.id).toBe(user.id);
    expect(await redeemSignInLink(token)).toBeNull();
    expect(await redeemSignInCode(email, codeIn(sent[1]!.text))).toBeNull();
    // A reset link is not a sign-in link.
    await requestPasswordReset(email);
    expect(await redeemSignInLink(linkToken(sent[2]!.text, "/reset-password"))).toBeNull();
    expect(await redeemSignInCode(email, codeIn(sent[2]!.text))).toBeNull();

    await requestSignInLink(email);
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await redeemSignInCode(email, codeIn(sent[3]!.text))).toBeNull();
    expect(await redeemSignInLink(linkToken(sent[3]!.text, "/login/email"))).toBeNull();
  });
});
