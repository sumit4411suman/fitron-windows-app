import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { codeAt, stepAt } from "@/lib/auth/totp";
import { hasDb, makeGym } from "@/test/db";

// The cookies, the request's address and the session writer are replaced; the actions, the signed challenge cookie, the
// two-step service and the database are real.
const jar = vi.hoisted(() => new Map<string, string>());
const request = vi.hoisted(() => ({ ip: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string) => void jar.delete(n),
  }),
  headers: async () => new Headers({ "x-forwarded-for": request.ip, "user-agent": "test" }),
}));
vi.mock("@/lib/auth/session", () => ({ createSession: vi.fn(), destroySession: vi.fn(), idleSignOut: vi.fn() }));

import { createSession } from "@/lib/auth/session";
import { TWO_STEP_COOKIE, challengeCookie } from "@/lib/auth/two-step-challenge";
import { sign } from "@/lib/integrations/google";
import { beginTwoStep, confirmTwoStep } from "@/lib/services/two-step";
import { login, verifyTwoStep } from "./actions";

const PASSWORD = "a-long-password-123";
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

/** Runs an action and says where it redirected to (the redirect is an exception), or what it returned. */
async function run<T>(fn: () => Promise<T>): Promise<{ to?: string; state?: T }> {
  try {
    return { state: await fn() };
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (digest?.startsWith("NEXT_REDIRECT")) return { to: digest.split(";")[2] };
    throw e;
  }
}

beforeEach(() => {
  jar.clear();
  request.ip = `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  vi.clearAllMocks();
});

describe.skipIf(!hasDb)("two-step sign-in, from the password to the session (database)", () => {
  /** A gym user with a known password who has turned two-step on. */
  async function member(withTwoStep: boolean) {
    const gym = await makeGym();
    const u = await gym.user("Admin");
    await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    let secret = "";
    let codes: string[] = [];
    if (withTwoStep) {
      ({ secret } = await beginTwoStep(u));
      codes = await confirmTwoStep(u, codeAt(secret, stepAt(Date.now())));
    }
    return { u, secret, codes };
  }
  const signIn = (email: string, next = "") => run(() => login(undefined, form({ email, password: PASSWORD, next })));
  /** A code the service will take: the next 30-second step's, which has not been used. */
  const goodCode = (secret: string) => codeAt(secret, stepAt(Date.now()) + 1);

  it("does not open a session after the password alone, when two-step is on", async () => {
    const { u } = await member(true);
    const r = await signIn(u.email, "/members");
    expect(r.to).toBe("/login?step=2");
    expect(createSession).not.toHaveBeenCalled();
    expect(jar.has(TWO_STEP_COOKIE)).toBe(true);
    expect(await db.auditLog.count({ where: { entityId: u.id, action: "auth.login" } })).toBe(0);
  });

  it("is unchanged for someone who has not turned it on", async () => {
    const { u } = await member(false);
    const r = await signIn(u.email, "/members");
    expect(r.to).toBe("/members");
    expect(createSession).toHaveBeenCalledWith(u.id);
    expect(jar.has(TWO_STEP_COOKIE)).toBe(false);
  });

  it("does not start the second step for a wrong password, and does not say whether two-step is on", async () => {
    const { u } = await member(true);
    const r = await run(() => login(undefined, form({ email: u.email, password: "wrong-password-1", next: "" })));
    expect(r.state).toMatchObject({ message: "Email or password is incorrect." });
    expect(jar.has(TWO_STEP_COOKIE)).toBe(false);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("opens the session once the right code is given, goes where the person was going, and audits how", async () => {
    const { u, secret } = await member(true);
    await signIn(u.email, "/members");
    const r = await run(() => verifyTwoStep(undefined, form({ code: goodCode(secret) })));
    expect(r.to).toBe("/members");
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith(u.id);
    expect(jar.has(TWO_STEP_COOKIE)).toBe(false);
    const a = await db.auditLog.findFirstOrThrow({ where: { entityId: u.id, action: "auth.login" } });
    expect(a.after).toMatchObject({ via: "email", secondStep: "code" });
  });

  it("does not open a session for a wrong code, and keeps the sign-in open for another try", async () => {
    const { u, secret } = await member(true);
    await signIn(u.email);
    const bad = await run(() => verifyTwoStep(undefined, form({ code: "000000" })));
    expect(bad.state).toMatchObject({ message: expect.stringMatching(/not right/) });
    expect(createSession).not.toHaveBeenCalled();
    expect(jar.has(TWO_STEP_COOKIE)).toBe(true);
    const good = await run(() => verifyTwoStep(undefined, form({ code: goodCode(secret) })));
    expect(good.to).toBe("/dashboard");
  });

  it("refuses a code that was already used, even with the right password", async () => {
    const { u, secret } = await member(true);
    const code = goodCode(secret);
    await signIn(u.email);
    await run(() => verifyTwoStep(undefined, form({ code })));
    vi.clearAllMocks();
    await signIn(u.email);
    const again = await run(() => verifyTwoStep(undefined, form({ code })));
    expect(again.state).toMatchObject({ message: expect.stringMatching(/not right/) });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("takes a recovery code once, and records that one was used", async () => {
    const { u, codes } = await member(true);
    await signIn(u.email);
    const r = await run(() => verifyTwoStep(undefined, form({ code: codes[0]!.toLowerCase() })));
    expect(r.to).toBe("/dashboard");
    expect((await db.auditLog.findFirstOrThrow({ where: { entityId: u.id, action: "auth.login" } })).after).toMatchObject({ secondStep: "recovery" });
    vi.clearAllMocks();
    await signIn(u.email);
    const again = await run(() => verifyTwoStep(undefined, form({ code: codes[0]! })));
    expect(again.state).toMatchObject({ message: expect.stringMatching(/not right/) });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("stops guessing: after eight wrong codes even the right one is refused for a while", async () => {
    const { u, secret } = await member(true);
    await signIn(u.email);
    for (let i = 0; i < 8; i++) await run(() => verifyTwoStep(undefined, form({ code: "000000" })));
    const r = await run(() => verifyTwoStep(undefined, form({ code: goodCode(secret) })));
    expect(r.state).toMatchObject({ message: expect.stringMatching(/Too many wrong codes/) });
    expect(createSession).not.toHaveBeenCalled();
  });

  describe("the cookie that says a code is still needed", () => {
    it("is needed: without it there is nothing to finish", async () => {
      const r = await run(() => verifyTwoStep(undefined, form({ code: "123456" })));
      expect(r.to).toBe("/login?twostep=expired");
      expect(createSession).not.toHaveBeenCalled();
    });

    it("cannot be made up, changed, or kept past five minutes", async () => {
      const { u, secret } = await member(true);
      const mine = challengeCookie({ uid: u.id, next: "/dashboard", via: "email" }).value;
      const other = (await member(true)).u;
      const [body, mac] = mine.split(".");
      const swapped = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), uid: other.id })).toString("base64url");
      for (const bad of [`${swapped}.${mac}`, "garbage", `${body}.`, sign({ uid: u.id, next: "/dashboard", via: "email" }, -1000)]) {
        jar.set(TWO_STEP_COOKIE, bad);
        const r = await run(() => verifyTwoStep(undefined, form({ code: goodCode(secret) })));
        expect(r.to, bad.slice(0, 12)).toBe("/login?twostep=expired");
      }
      expect(createSession).not.toHaveBeenCalled();
    });

    it("is of no use for someone who has been deactivated since", async () => {
      const { u, secret } = await member(true);
      await signIn(u.email);
      await db.user.update({ where: { id: u.id }, data: { active: false } });
      const r = await run(() => verifyTwoStep(undefined, form({ code: goodCode(secret) })));
      expect(r.to).toBe("/login?twostep=expired");
      expect(jar.has(TWO_STEP_COOKIE)).toBe(false);
      expect(createSession).not.toHaveBeenCalled();
    });

    it("never sends the person anywhere but this site, and records Google as how they got this far", async () => {
      const { u, secret } = await member(true);
      const c = challengeCookie({ uid: u.id, next: "//evil.example/steal", via: "google" });
      jar.set(c.name, c.value);
      const r = await run(() => verifyTwoStep(undefined, form({ code: goodCode(secret) })));
      expect(r.to).toBe("/dashboard");
      expect((await db.auditLog.findFirstOrThrow({ where: { entityId: u.id, action: "auth.login" } })).after).toMatchObject({ via: "google", secondStep: "code" });
    });

    it("does not carry over to someone else: it is for the person who gave the password", async () => {
      const a = await member(true);
      const b = await member(true);
      await signIn(a.u.email);
      const r = await run(() => verifyTwoStep(undefined, form({ code: goodCode(b.secret) })));
      expect(r.state).toMatchObject({ message: expect.stringMatching(/not right/) });
      expect(createSession).not.toHaveBeenCalled();
    });
  });
});
