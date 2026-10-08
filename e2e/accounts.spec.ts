import { expect, newContext, setPlan, signIn, signOut, signUp, sql, test, unique } from "./support";

test.describe("sign-up and sign-in", () => {
  test("a gym owner signs up, reaches the dashboard, signs out and signs back in", async ({ page }) => {
    const gym = await signUp(page, { tag: "signup" });
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();

    await signOut(page);
    await page.goto("/dashboard");
    await expect(page, "a signed-out visitor is sent to sign in").toHaveURL(/\/login/);

    await signIn(page, gym);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  });

  test("the sign-in page sends a person on to the page they asked for", async ({ page }) => {
    const gym = await signUp(page, { tag: "next" });
    await signOut(page);
    await page.goto("/members");
    await expect(page).toHaveURL(/\/login\?.*next=/);
    await page.getByLabel("Email").fill(gym.email);
    await page.getByLabel("Password").fill(gym.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/members$/);
  });

  test("a wrong password is refused, and says so without saying which half was wrong", async ({ page }) => {
    const gym = await signUp(page, { tag: "wrong" });
    await signOut(page);
    await signIn(page, gym, "not-the-password-1");
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email").fill(`nobody-${unique()}@example.com`);
    await page.getByLabel("Password").fill(gym.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  });

  test("an email that already has an account is turned away before the gym is asked about", async ({ page }) => {
    const gym = await signUp(page, { tag: "dupe" });
    await signOut(page);
    await page.goto("/login?tab=up&plan=professional&cycle=MONTHLY");
    await page.getByLabel("Your name").fill("Someone Else");
    await page.getByLabel("Email", { exact: true }).fill(gym.email.toUpperCase());
    await page.getByLabel("Password").fill(gym.password);
    await page.locator("#ft-agree").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("An account with this email exists. Sign in instead.").first()).toBeVisible();
    await expect(page.getByText("Set up your gym")).toHaveCount(0);
  });

  test("signing up needs the terms to be accepted", async ({ page }) => {
    await page.goto("/login?tab=up&plan=professional&cycle=MONTHLY");
    await page.getByLabel("Your name").fill("No Terms");
    await page.getByLabel("Email", { exact: true }).fill(`e2e-${unique()}@example.com`);
    await page.getByLabel("Password").fill("a-long-password-123");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Set up your gym")).toHaveCount(0);
  });
});

test.describe("the plan chosen on the site is the plan the gym gets", () => {
  for (const plan of ["starter", "professional", "enterprise"] as const) {
    test(plan, async ({ page }) => {
      const gym = await signUp(page, { plan, tag: `plan-${plan}` });
      const [org] = await sql<{ plan: string; trial: boolean }>(
        `select o.plan, o."trialEndsAt" > now() as trial from "Organization" o join "User" u on u."orgId" = o.id where u.email = $1`,
        [gym.email],
      );
      expect(org?.plan).toBe(plan);
      expect(org?.trial, "a free trial is running").toBe(true);
      // The account menu says the trial is running, and the billing page says until when.
      await page.getByRole("button", { name: "Account menu" }).click();
      await expect(page.getByRole("menuitem", { name: /Plan & billing/ })).toContainText("Free trial");
      await page.goto("/settings/billing");
      await expect(page.getByText(/Free trial till/).first()).toBeVisible();
    });
  }

  test("moving a gym to another plan opens its pages at once", async ({ page }) => {
    const gym = await signUp(page, { plan: "starter", tag: "upgrade" });
    const blocked = await page.request.get("/purchases/csv", { maxRedirects: 0 });
    expect(blocked.status()).toBe(403);
    await setPlan(gym.email, "professional");
    const open = await page.request.get("/purchases/csv", { maxRedirects: 0 });
    expect(open.status()).toBe(200);
  });
});

test("guessing passwords is slowed down: after five tries the page asks to wait", async ({ page }) => {
  const gym = await signUp(page, { tag: "limit" });
  await signOut(page);
  await page.goto("/login");
  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password");
  // Wait for the server's answer to each try: the last try's message is still on the page while the next is sent.
  const submit = async (word: string) => {
    await email.fill(gym.email);
    await password.fill(word);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/login"), page.getByRole("button", { name: "Sign in" }).click()]);
  };
  for (let i = 0; i < 5; i++) {
    await submit(`wrong-password-${i}`);
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  }
  await submit(gym.password);
  await expect(page.getByText("Too many attempts. Wait a minute and try again."), "even the right password waits").toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a new gym owner is offered the product tour once, and skipping it keeps it away", async ({ browser }) => {
  const ctx = await newContext(browser, {}, { showTour: true });
  const page = await ctx.newPage();
  await signUp(page, { tag: "tour" });
  const tour = page.getByRole("dialog", { name: "Product tour" });
  await expect(tour).toBeVisible();
  await expect(tour).toContainText("Welcome to Fitron");
  await tour.getByRole("button", { name: "Skip tour" }).click();
  await expect(tour).toHaveCount(0);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500); // the tour opens 0.9 s after the page does
  await expect(page.getByRole("dialog", { name: "Product tour" })).toHaveCount(0);
  // It can be started again from the account menu.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Product tour" }).click();
  await expect(page.getByRole("dialog", { name: "Product tour" })).toBeVisible();
  await ctx.close();
});
