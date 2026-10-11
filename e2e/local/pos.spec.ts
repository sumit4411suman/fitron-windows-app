import { expect, signUp, sql, test, unique } from "../support";
import { orgOf } from "./helpers";

// POS and inventory (module 10). A counter sale makes a GST invoice for the walk-in customer and a stock movement.
test("a counter sale of a service product makes an invoice and is paid", async ({ page }) => {
  const gym = await signUp(page, { tag: "pos" });
  const name = `Day pass ${unique()}`;
  const sku = `DP${unique().slice(-5).toUpperCase()}`;
  await page.goto("/products/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("SKU / short code").fill(sku);
  await page.getByLabel("Selling price before GST (₹)").fill("200");
  await page.getByLabel("Cost price (₹)").fill("0");
  await page.getByText("Track stock").click(); // a service: no stock to count
  await page.getByRole("button", { name: "Add product" }).click();
  await page.waitForURL((u) => u.pathname !== "/products/new");

  await page.goto("/pos");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: /^Charge .* and print receipt$/ }).click();
  await page.waitForURL(/\/invoices\/[^/?]+\?created=1/);
  await expect(page.getByText("PAID", { exact: true })).toBeVisible();

  const orgId = await orgOf(gym.email);
  const items = await sql<{ amount: number; description: string }>(
    `select ii.amount, ii.description from "InvoiceItem" ii join "Invoice" i on i.id = ii."invoiceId" join "Product" p on p.id = ii."productId" where i."orgId" = $1 and p.sku = $2`,
    [orgId, sku],
  );
  expect(items).toHaveLength(1);
  expect(items[0]!.amount, "₹200 before GST, in paise").toBe(20000);
});
