import { addMember, expect, gymWithPlan, sell, test, unique } from "../support";
import { addExpense, noErrorScreen } from "./helpers";

// Reports (module 9). Every report in the Report Center opens with data in the books, and downloads as CSV and Excel.
test("every report opens and downloads, with a sale and an expense in the books", async ({ page }) => {
  test.setTimeout(180_000);
  await gymWithPlan(page, { name: `Monthly ${unique()}`, months: 1, price: 1000 });
  const memberId = await addMember(page, `Arjun ${unique()}`);
  await sell(page, memberId, { payNow: 400 });
  await addExpense(page, { description: `Water ${unique()}`, amount: 120 });

  await page.goto("/reports");
  await noErrorScreen(page);
  const keys = await page.getByLabel("Report", { exact: true }).locator("option").evaluateAll((os) => [...new Set(os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))]);
  expect(keys.length, "the Report Center lists its reports").toBeGreaterThan(10);
  for (const key of keys) {
    const res = await page.goto(`/reports/${key}`);
    expect(res?.status(), key).toBe(200);
    await noErrorScreen(page);
    for (const kind of ["csv", "xls"]) {
      const file = await page.request.get(`/reports/${key}/${kind}`);
      expect(file.status(), `${key}/${kind}`).toBe(200);
    }
  }
});
