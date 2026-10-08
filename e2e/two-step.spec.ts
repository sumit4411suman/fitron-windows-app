import { expect, signIn, signOut, signUp, sql, test, totp } from "./support";

test("two-step sign-in: set up with an authenticator code, then every sign-in asks for one", async ({ page }) => {
  const gym = await signUp(page, { tag: "two-step" });

  // --- Set up: the secret is shown for the app; the person proves the app makes the right code.
  await page.goto("/profile?tab=twostep");
  await page.getByRole("button", { name: "Set up two-step sign-in" }).click();
  await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  const secret = (await page.locator("li code").first().innerText()).replace(/\s/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  await page.getByLabel("Code from the app").fill(totp(secret, Date.now() + 5 * 60_000));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("That code is not right.").first()).toBeVisible();
  expect((await sql(`select 1 from "User" where email = $1 and "totpEnabledAt" is not null`, [gym.email])).length, "a wrong code does not turn it on").toBe(0);

  await page.getByLabel("Code from the app").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  const region = page.getByRole("region", { name: "Recovery codes" });
  await expect(region).toBeVisible();
  const recovery = (await region.locator("li").allInnerTexts()).map((s) => s.trim());
  expect(recovery).toHaveLength(10);
  expect(new Set(recovery).size).toBe(10);
  await region.getByLabel("I have saved these codes").check();
  await region.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Two-step sign-in is on")).toBeVisible();
  expect((await sql(`select "totpSecret" from "User" where email = $1`, [gym.email]))[0]?.totpSecret, "the secret is stored sealed, not as text").not.toEqual(expect.stringContaining(secret));

  // --- Sign-in: the password alone gets no session.
  await signOut(page);
  await signIn(page, gym);
  await expect(page).toHaveURL(/\/login\?step=2/);
  await page.goto("/dashboard");
  await expect(page, "the dashboard stays closed until the code is given").toHaveURL(/\/login/);
  await signIn(page, gym);
  await expect(page).toHaveURL(/step=2/);

  const code = page.getByLabel("Code from your authenticator app");
  const verify = page.getByRole("button", { name: "Verify and sign in" });
  await code.fill(totp(secret, Date.now() + 5 * 60_000));
  await verify.click();
  await expect(page.getByText("That code is not right.").first()).toBeVisible();

  // The code that turned it on is spent; the next 30-second step's code (inside the phone-clock allowance) is not.
  const next = totp(secret, Date.now() + 30_000);
  await code.fill(next);
  await verify.click();
  await expect(page).toHaveURL(/\/dashboard/);

  // --- A code works once.
  await signOut(page);
  await signIn(page, gym);
  await page.getByLabel("Code from your authenticator app").fill(next);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByText("That code is not right.").first()).toBeVisible();

  // --- A recovery code signs in, once.
  await page.getByLabel("Code from your authenticator app").fill(recovery[0]!);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  expect((await sql(`select count(*)::int as n from "RecoveryCode" r join "User" u on u.id = r."userId" where u.email = $1 and r."usedAt" is null`, [gym.email]))[0]?.n).toBe(9);

  await signOut(page);
  await signIn(page, gym);
  await page.getByLabel("Code from your authenticator app").fill(recovery[0]!);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByText("That code is not right.").first()).toBeVisible();

  // --- Turning it off needs the password and a code (a recovery code will do), then sign-in is by password alone.
  await page.getByLabel("Code from your authenticator app").fill(recovery[1]!);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/profile?tab=twostep");
  await page.getByLabel("Your password").last().fill("not-the-password-1");
  await page.getByLabel("A code from your app, or a recovery code").fill(recovery[2]!);
  await page.getByRole("button", { name: "Turn off two-step sign-in" }).click();
  await expect(page.getByText("Your password is wrong.").first()).toBeVisible();
  await page.getByLabel("Your password").last().fill(gym.password);
  await page.getByLabel("A code from your app, or a recovery code").fill(recovery[2]!);
  await page.getByRole("button", { name: "Turn off two-step sign-in" }).click();
  await expect(page.getByText("Two-step sign-in is off")).toBeVisible();

  await signOut(page);
  await signIn(page, gym);
  await expect(page).toHaveURL(/\/dashboard/);
});
