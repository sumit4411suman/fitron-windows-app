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

test("GST without a GSTIN is refused beside the field, and the GST tick stays as the owner left it", async ({ page }) => {
  await signUp(page, { plan: "professional", tag: "gst-gstin" });
  await page.goto("/settings?tab=billing");
  const gst = page.getByLabel("Charge GST on invoices");
  await gst.uncheck();
  await page.getByLabel("GSTIN").fill("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Changes are recorded in the audit log.")).toBeVisible();

  await gst.check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Add your GSTIN to charge GST.")).toBeVisible();
  await expect(gst, "not silently switched back off").toBeChecked();

  await page.getByLabel("GSTIN").fill("20ABCDE1234F1Z5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Changes are recorded in the audit log.")).toBeVisible();
  await page.reload();
  await expect(gst).toBeChecked();
});

test("a blank gym name says so in plain words, without the field's internal name", async ({ page }) => {
  await signUp(page, { plan: "professional", tag: "gym-name" });
  await page.goto("/settings");
  const name = page.getByLabel("Gym name", { exact: true });
  // Spaces get past the browser's own check; the server's answer is what this is about.
  await name.fill("   ");
  await name.locator("xpath=ancestor::form").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Enter the gym name.", { exact: true })).toBeVisible();
  await expect(page.getByText("name: Enter the gym name.")).toHaveCount(0);
});
