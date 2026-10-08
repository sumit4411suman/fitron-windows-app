import { expect, signUp, test } from "./support";

// Settings the owner changes in the browser, and whether they stick.

test("the monthly profit-and-loss email can be switched off, and stays off", async ({ page }) => {
  await signUp(page, { plan: "professional", tag: "pl-email" });
  await page.goto("/settings?tab=reminders");
  const box = page.getByRole("checkbox", { name: /profit and loss to the Super Admins/i });
  await expect(box, "on until the gym says otherwise").toBeChecked();

  await box.uncheck();
  await page.locator("form").filter({ has: box }).getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/saved=reminders/);
  await page.goto("/settings?tab=reminders");
  await expect(box).not.toBeChecked();

  await box.check();
  await page.locator("form").filter({ has: box }).getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/saved=reminders/);
  await page.goto("/settings?tab=reminders");
  await expect(box).toBeChecked();
});

test("a Starter gym is told the monthly profit and loss belongs to a higher plan", async ({ page }) => {
  await signUp(page, { plan: "starter", tag: "pl-email-starter" });
  await page.goto("/settings?tab=reminders");
  await expect(page.getByText("The monthly profit and loss is part of Accounting, on the Professional plan.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /profit and loss to the Super Admins/i })).toBeDisabled();
});
