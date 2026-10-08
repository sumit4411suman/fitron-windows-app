import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Two-step sign-in is only as strong as the places that open a session. A new one added without the check would let
// someone in with a password alone, so every place is listed here, and a new one fails this test until it is looked at.
const root = path.join(__dirname, "../../..");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (n === "generated" || n === "node_modules") return [];
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const rel = (f: string) => path.relative(root, f).replaceAll("\\", "/");

describe("every place that opens a staff session", () => {
  it("is a known one", () => {
    const sites = sourceFiles(path.join(root, "src"))
      .filter((f) => !rel(f).endsWith("lib/auth/session.ts"))
      .filter((f) => /\bcreateSession\(/.test(readFileSync(f, "utf8")))
      .map(rel)
      .sort();
    expect(sites, "a new createSession( call needs the two-step check before it: see src/app/login/actions.ts").toEqual(["src/app/(site)/account-actions.ts", "src/app/auth/google/callback/route.ts", "src/app/login/actions.ts"]);
  });

  it("asks for the second step first, after the password", () => {
    const s = read("src/app/login/actions.ts");
    const login = s.slice(s.indexOf("export async function login("), s.indexOf("export async function verifyTwoStep("));
    expect(login.indexOf("user.totpEnabledAt")).toBeGreaterThan(-1);
    expect(login.indexOf("startChallenge(")).toBeGreaterThan(-1);
    expect(login.indexOf("startChallenge(")).toBeLessThan(login.indexOf("createSession("));
  });

  it("opens the session after a code is verified, in the second step", () => {
    const s = read("src/app/login/actions.ts");
    const step = s.slice(s.indexOf("export async function verifyTwoStep("), s.indexOf("export async function logout("));
    expect(step.indexOf("verifySecondFactor(")).toBeGreaterThan(-1);
    expect(step.indexOf("verifySecondFactor(")).toBeLessThan(step.indexOf("createSession("));
    expect(step.indexOf("if (!how)")).toBeLessThan(step.indexOf("createSession("));
  });

  it("asks for the second step after an emailed code or link, too", () => {
    const s = read("src/app/login/actions.ts");
    const finish = s.slice(s.indexOf("async function finishEmailSignIn("), s.indexOf("const clientIp"));
    expect(finish.indexOf("user.totpEnabledAt")).toBeGreaterThan(-1);
    expect(finish.indexOf("startChallenge(")).toBeLessThan(finish.indexOf("createSession("));
    // Both ways in end there, and neither opens a session by itself.
    expect(s.match(/finishEmailSignIn\(/g)).toHaveLength(3);
    expect(s.indexOf("redeemSignInCode(")).toBeLessThan(s.indexOf('finishEmailSignIn(user, "email-code"'));
    expect(s.indexOf("redeemSignInLink(")).toBeLessThan(s.indexOf('finishEmailSignIn(user, "email-link"'));
  });

  it("asks for the second step after Google, too", () => {
    const s = read("src/app/auth/google/callback/route.ts");
    const staffIn = s.slice(s.indexOf("async function staffIn("));
    expect(staffIn.indexOf("user.totpEnabledAt")).toBeGreaterThan(-1);
    expect(staffIn.indexOf("challengeCookie(")).toBeLessThan(staffIn.indexOf("createSession("));
  });

  it("opens a session at sign-up only for the account that was just created, where nothing has been set up yet", () => {
    const s = read("src/app/(site)/account-actions.ts");
    expect(s.indexOf("createGymAccount(")).toBeGreaterThan(-1);
    expect(s.indexOf("createGymAccount(")).toBeLessThan(s.indexOf("createSession("));
  });
});
