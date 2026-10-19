import { expect, test, watch } from "./support";

// The Business Intelligence suite (docs/BUSINESS-INTELLIGENCE.md) driven the way an owner would: a scenario in the
// Profit Simulator's live editor, saved and reopened; a decision with an option, approved with reasoning; the
// recovery queue and the Growth Engine on a gym with nothing to chase yet.

test("a scenario is built in the live editor, saved, reopened and exported", async ({ signedIn: page }) => {
  const seen = watch(page);
  await page.goto("/intelligence/simulator/new");
  await expect(page.getByRole("heading", { name: "New scenario" })).toBeVisible();
  // A fresh gym has no plans: add one to the mix and watch the forecast appear at once.
  await page.getByRole("button", { name: "+ Plan" }).click();
  await page.getByLabel("Plan name").fill("Monthly");
  await page.getByRole("spinbutton", { name: "Members", exact: true }).fill("100");
  await page.getByLabel("Price in rupees").fill("1500");
  await page.getByRole("spinbutton", { name: "Rent", exact: true }).fill("30000");
  await expect(page.getByText("Projected revenue")).toBeVisible();
  await page.getByLabel("Scenario name").fill("Hundred members at ₹1,500");
  await page.getByRole("button", { name: "Save scenario" }).click();
  await page.waitForURL(/\/intelligence\/simulator\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Hundred members at ₹1,500" })).toBeVisible();
  await expect(page.getByText("Conservative, baseline and optimistic")).toBeVisible();
  // The list shows it with its forecast, and the CSV report downloads.
  await page.goto("/intelligence/simulator");
  await expect(page.getByRole("link", { name: "Hundred members at ₹1,500" })).toBeVisible();
  await page.getByRole("link", { name: "Hundred members at ₹1,500" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export report (CSV)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^scenario-.*\.csv$/);
  expect(await seen.all()).toEqual([]);
});

test("a decision is created, given an option, and approved with reasoning", async ({ signedIn: page }) => {
  const seen = watch(page);
  await page.goto("/intelligence/decisions/new");
  await page.getByLabel("Title").fill("Hire an evening trainer");
  await page.getByLabel("Category").selectOption("HIRING");
  await page.getByLabel("Objective").fill("Serve evening members without queues at the racks.");
  await page.getByRole("button", { name: "Create the decision" }).click();
  await page.waitForURL(/\/intelligence\/decisions\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Hire an evening trainer" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Do nothing (baseline)" })).toBeVisible();
  await page.getByRole("link", { name: "Add an option" }).click();
  await page.getByRole("button", { name: "+ Plan" }).click();
  await page.getByLabel("Plan name").fill("Monthly");
  await page.getByRole("spinbutton", { name: "Members", exact: true }).fill("80");
  await page.getByLabel("Price in rupees").fill("1800");
  await page.getByRole("spinbutton", { name: "Trainer and staff pay", exact: true }).fill("25000");
  await page.getByLabel("Scenario name").fill("Hire full time");
  await page.getByLabel("Member experience (1–5, your judgement)").selectOption("5");
  await page.getByRole("button", { name: "Add the option" }).click();
  await expect(page.getByText("Option saved.")).toBeVisible();
  await page.goto(page.url().split("?")[0]!);
  await expect(page.getByRole("cell", { name: /Hire full time/ })).toBeVisible();
  await page.getByLabel("Verdict").selectOption("APPROVED");
  await page.getByLabel("Chosen option (for approval)").selectOption({ label: "Hire full time" });
  await page.getByLabel("Reasoning").fill("Evening demand is there and the pay fits the budget.");
  await page.getByRole("button", { name: "Record the verdict" }).click();
  await expect(page.getByText("Recorded.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Chosen", { exact: true })).toBeVisible();
  expect(await seen.all()).toEqual([]);
});

test("the recovery queue and the Growth Engine say plainly when there is nothing to act on", async ({ signedIn: page }) => {
  const seen = watch(page);
  await page.goto("/intelligence/recovery");
  await expect(page.getByText("Nothing to chase")).toBeVisible();
  await expect(page.getByText("Recovery rate")).toBeVisible();
  await page.getByRole("button", { name: "Refresh from the books" }).click();
  await expect(page.getByText("Nothing to chase")).toBeVisible();
  await page.goto("/intelligence");
  await expect(page.getByText("Nothing to recommend")).toBeVisible();
  await page.goto("/intelligence/ltv");
  await expect(page.getByText("No members match")).toBeVisible();
  await page.goto("/intelligence/benchmarking");
  await expect(page.getByText("Unavailable")).toBeVisible();
  await expect(page.getByText("Methodology and privacy")).toBeVisible();
  expect(await seen.all()).toEqual([]);
});
