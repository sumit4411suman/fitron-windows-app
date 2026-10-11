import { expect, signUp, sql, test, unique } from "../support";
import { noErrorScreen, orgOf } from "./helpers";

// Fixed assets (module 11). An asset is registered at cost in paise and appears in the register with its depreciation.
test("an asset is registered at cost and shows in the asset register report", async ({ page }) => {
  const gym = await signUp(page, { tag: "asset" });
  const name = `Treadmill ${unique()}`;
  await page.goto("/assets/new");
  await page.getByLabel("Asset", { exact: true }).fill(name);
  await page.getByLabel("Total cost incl. GST (₹)").fill("85000");
  await page.getByRole("button", { name: "Add asset" }).click();
  await page.waitForURL((u) => /^\/assets\/[^/]+$/.test(u.pathname) && u.pathname !== "/assets/new");
  await noErrorScreen(page);
  await expect(page.getByText(name).first()).toBeVisible();

  const orgId = await orgOf(gym.email);
  const [a] = await sql<{ cost: number; status: string }>(`select cost, status from "Asset" where "orgId" = $1 and name = $2`, [orgId, name]);
  expect(a).toEqual({ cost: 8_500_000, status: "IN_USE" });

  await page.goto("/reports/assets");
  await noErrorScreen(page);
  await expect(page.locator("main").getByText(name).first()).toBeVisible();
});
