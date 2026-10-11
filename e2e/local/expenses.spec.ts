import { expect, signUp, sql, test, unique } from "../support";
import { addExpense, orgOf } from "./helpers";

// Expenses (module 5). Recorded on the screen, stored in paise, voided rather than deleted.
test("an expense is recorded in paise and a void keeps the row with its reason", async ({ page }) => {
  const gym = await signUp(page, { tag: "expense" });
  const description = `Electricity ${unique()}`;
  await addExpense(page, { description, amount: 2499.5 });
  const orgId = await orgOf(gym.email);
  const [row] = await sql<{ id: string; amount: number; status: string }>(`select id, amount, status from "Expense" where "orgId" = $1 and description = $2`, [orgId, description]);
  expect(row, "₹2,499.50 is 249950 paise").toMatchObject({ amount: 249950, status: "ACTIVE" });
  // The list shows whole rupees (src/lib/format.ts formatRupees); the books keep the paise.
  await expect(page.locator("main").getByText("₹2,500").first()).toBeVisible();

  // The database refuses to lose it, whoever asks.
  await expect(sql(`delete from "Expense" where id = $1`, [row!.id])).rejects.toThrow(/not allowed/);
  expect(await sql(`select 1 from "Expense" where id = $1`, [row!.id])).toHaveLength(1);
});
