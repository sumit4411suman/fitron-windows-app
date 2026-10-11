import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { EDITION } from "../env";
import { expect, test } from "../support";
import { startLocalServer, type LocalServer } from "./server";

// Phase 8 / Phase 22 (startup): FITRON on a new computer. A fresh data folder, the production build started in Local
// mode, then: first-run setup, the recovery key, the owner's console, sign-out, a lockout after wrong passwords, a reset
// with the recovery key, and a restart that keeps everything. Local Edition only.
test.describe.configure({ mode: "serial" });
test.skip(EDITION !== "local", "Local Edition only (npm run e2e:local)");

const PORT = 3301;
const owner = { gym: "Power Haus Gym", name: "Asha Verma", email: "owner@powerhaus.in", password: "a-long-password-1" };
let dataDir: string;
let server: LocalServer;
let recoveryKey = "";

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "fitron-startup-"));
  server = await startLocalServer(dataDir, PORT);
});
test.afterAll(async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

const open = async (browser: Browser): Promise<Page> => {
  const ctx = await browser.newContext({ baseURL: server.url, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  // The welcome tour would cover the dashboard; it remembers it was seen in the browser.
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${owner.email}`);
  return ctx.newPage();
};

async function signIn(page: Page, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("starts on a new computer: data folder made, keys made, healthy, ready for setup", async ({ request }) => {
  const health = await (await request.get(`${server.url}/api/health`)).json();
  expect(health).toMatchObject({ ok: true, edition: "local" });
  for (const d of ["data", "backups", "documents", "logs"]) expect(existsSync(path.join(dataDir, d)), d).toBe(true);
  expect(existsSync(path.join(dataDir, "data", "fitron.db"))).toBe(true);
  const secrets = JSON.parse(readFileSync(path.join(dataDir, "secrets.json"), "utf8")) as Record<string, string>;
  expect(secrets.installationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(secrets.BIOMETRIC_KEY).toMatch(/^[0-9a-f]{64}$/);
});

test("the sign-in, the website sign-up and the email reset all lead to first-run setup", async ({ browser }) => {
  const page = await open(browser);
  for (const p of ["/login", "/dashboard", "/signup", "/forgot-password", "/login?tab=up"]) {
    await page.goto(p);
    await expect(page, p).toHaveURL(/\/setup$/);
  }
  await expect(page.getByRole("heading", { name: "Set up FITRON on this computer" })).toBeVisible();
  await expect(page.getByText(/Google/)).toHaveCount(0);
});

test("first-run setup checks the form, creates the gym and owner, and shows the recovery key once", async ({ browser }) => {
  const page = await open(browser);
  await page.goto("/setup");
  await page.getByLabel("Gym name").fill(owner.gym);
  await page.getByLabel("Mobile number").fill("9876543210");
  await page.getByLabel("Your name").fill(owner.name);
  await page.getByLabel("Email").fill(owner.email);
  await page.locator('input[name="password"]').fill(owner.password);
  await page.locator('input[name="confirm"]').fill("something-else-1");
  await page.getByRole("button", { name: "Create gym and owner" }).click();
  await expect(page.getByText("The two passwords are not the same.")).toBeVisible();
  // What was typed stays, except the passwords.
  await expect(page.getByLabel("Gym name")).toHaveValue(owner.gym);
  await expect(page.locator('input[name="password"]')).toHaveValue("");

  await page.locator('input[name="password"]').fill(owner.password);
  await page.locator('input[name="confirm"]').fill(owner.password);
  await page.getByRole("button", { name: "Create gym and owner" }).click();
  const key = page.getByLabel("Recovery key", { exact: true });
  await expect(key).toHaveText(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
  recoveryKey = (await key.textContent())!.trim();

  const go = page.getByRole("link", { name: "Continue to FITRON" });
  await expect(go).toHaveAttribute("aria-disabled", "true");
  await page.getByLabel("I have saved the recovery key").check();
  await go.click();
  await page.waitForURL(/\/onboarding/);
  await page.getByRole("button", { name: "I'll finish this later" }).click();
  await page.waitForURL(/\/dashboard/);
  await expect(page.getByText(owner.gym).filter({ visible: true }).first()).toBeVisible();

  // Setup is closed now: the page sends a signed-in owner to the dashboard.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/dashboard/);

  // FITRON for Windows is Gym Accounting only: the website, the AI Trainer, FITRON's own billing, the Gym Partnership
  // and the FITRON team console lead back to the console, and the menus do not offer them.
  for (const p of ["/", "/trainer", "/gym-accounting", "/fitron-admin", "/settings/billing", "/partnership", "/plan-ended"]) {
    await page.goto(p);
    await expect(page, p).toHaveURL(/\/dashboard$/);
  }
  // The website's contact page (an error screen's "Contact support") is the console's own Help & support.
  await page.goto("/contact?topic=support");
  await expect(page).toHaveURL(/\/settings\?tab=help$/);
  await expect(page.getByRole("link", { name: "Gym Partnership" })).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: "Subscription" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Backup" }).first()).toBeVisible();

  // Phase 13: the licence instead of FITRON's plan billing. A new installation is on its 30-day trial, shows the
  // installation id to send FITRON, and refuses anything that is not a licence FITRON signed.
  await page.getByRole("link", { name: "Licence", exact: true }).click();
  await expect(page.getByText(/^Free trial: 30 days left/)).toBeVisible();
  await expect(page.locator("code").filter({ hasText: /^[0-9a-f-]{36}$/ })).toBeVisible();
  await page.getByLabel("Or paste the licence text").fill("FITRON-LICENCE-1.not.real");
  await page.getByRole("button", { name: "Import licence" }).click();
  await expect(page.getByText(/This licence (file is damaged|was not signed by FITRON)|has no licence key built in/).first()).toBeVisible();
});

test("sign-in offers only what works offline, and locks the account after five wrong passwords", async ({ browser }) => {
  const page = await open(browser);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to FITRON" })).toBeVisible();
  for (const absent of [/Google/, /Create account/, /Email me a code/, /fitron\.in/]) await expect(page.getByText(absent)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/recover");

  for (let i = 0; i < 5; i++) {
    await signIn(page, `wrong-password-${i}`);
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  }
  await signIn(page, owner.password);
  await expect(page.getByText(/Too many wrong passwords for this account/)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("the recovery key resets the owner's password, ends the lockout, and is replaced", async ({ browser }) => {
  const page = await open(browser);
  await page.goto("/recover");
  await page.getByLabel("Owner's email").fill(owner.email);
  await page.locator('input[name="recoveryKey"]').fill("AAAA-BBBB-CCCC-DDDD-EEEE");
  await page.locator('input[name="password"]').fill("a-new-password-2");
  await page.locator('input[name="confirm"]').fill("a-new-password-2");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText("That email and recovery key do not match an owner on this computer.")).toBeVisible();

  await page.locator('input[name="recoveryKey"]').fill(recoveryKey.toLowerCase());
  await page.locator('input[name="password"]').fill("a-new-password-2");
  await page.locator('input[name="confirm"]').fill("a-new-password-2");
  await page.getByRole("button", { name: "Set new password" }).click();
  const next = page.getByLabel("New recovery key", { exact: true });
  await expect(next).toHaveText(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
  expect((await next.textContent())!.trim()).not.toBe(recoveryKey);
  owner.password = "a-new-password-2";

  await signIn(page, owner.password);
  await page.waitForURL(/\/dashboard/);
});

test("after a restart the gym, the owner and the new password are all still there", async ({ browser }) => {
  await server.stop();
  server = await startLocalServer(dataDir, PORT);
  const page = await open(browser);
  await signIn(page, owner.password);
  await page.waitForURL(/\/dashboard/);
  await expect(page.getByText(owner.gym).filter({ visible: true }).first()).toBeVisible();
  // The database is the same file; nothing ran first-run setup again.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/dashboard/);
});
