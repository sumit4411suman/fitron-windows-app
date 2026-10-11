import { addMember, expect, gymWithPlan, sell, test, unique } from "../support";
import { noErrorScreen } from "./helpers";

// GST (module 7). The GST invoice register splits CGST and SGST and adds up to the invoice.
test("the GST invoice register lists the sale with CGST and SGST, on screen and as a download", async ({ page }) => {
  await gymWithPlan(page, { name: `Quarterly ${unique()}`, months: 3, price: 1500 });
  const member = `Neha ${unique()}`;
  const memberId = await addMember(page, member);
  await sell(page, memberId);

  await page.goto("/reports/gst-invoices");
  await noErrorScreen(page);
  const main = page.locator("main");
  await expect(main.getByText(member).first()).toBeVisible();
  // ₹1,500 at 18%: CGST ₹135 + SGST ₹135 = ₹1,770.
  await expect(main.getByText("₹135").first()).toBeVisible();
  await expect(main.getByText("₹1,770").first()).toBeVisible();

  const csv = await page.request.get("/reports/gst-invoices/csv");
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain(member);
  expect(text).toMatch(/135/);
});
