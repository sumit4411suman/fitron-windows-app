import { addMember, expect, gymWithPlan, sell, sql, test, unique } from "../support";
import { addExpense, noErrorScreen, orgOf } from "./helpers";

// Accounting and ledger (module 6). A sale and an expense reach the profit and loss and the ledgers.
test("a membership sale and an expense show in the profit and loss and in the ledgers", async ({ page }) => {
  const gym = await gymWithPlan(page, { name: `Monthly ${unique()}`, months: 1, price: 1500 });
  const memberId = await addMember(page, `Kiran ${unique()}`);
  await sell(page, memberId);
  await addExpense(page, { description: `Cleaning ${unique()}`, amount: 400 });

  await page.goto("/accounting");
  await noErrorScreen(page);
  const main = page.locator("main");
  await expect(main.getByText("Revenue").first()).toBeVisible();
  // Revenue is the taxable value (GST is not the gym's income): ₹1,500. The expense: ₹400.
  await expect(main.getByText("₹1,500").first()).toBeVisible();
  await expect(main.getByText("₹400").first()).toBeVisible();

  for (const tab of ["ledger", "close"]) {
    await page.goto(`/accounting?tab=${tab}`);
    await noErrorScreen(page);
  }
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const csv = await page.request.get(`/accounting/csv?kind=pl&from=${today.slice(0, 7)}-01&to=${today}`);
  expect(csv.status()).toBe(200);
  const pl = await csv.text();
  expect(pl).toMatch(/Total revenue,1500\.00/);
  expect(pl).toMatch(/Total expenses,400\.00/);
  expect(pl).toMatch(/Net,1100\.00/);

  const orgId = await orgOf(gym.email);
  const [t] = await sql<{ income: number; spent: number }>(
    `select (select coalesce(sum(subtotal - discount), 0)::int from "Invoice" where "orgId" = $1 and status = 'ISSUED') as income, (select coalesce(sum(amount), 0)::int from "Expense" where "orgId" = $1 and status = 'ACTIVE') as spent`,
    [orgId],
  );
  expect(t).toEqual({ income: 150000, spent: 40000 });
});
