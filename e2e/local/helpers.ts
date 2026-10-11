import type { Page } from "@playwright/test";
import { expect, sql } from "../support";

// Shared by the module specs in e2e/local. These specs run on both editions (`npm run e2e` on PostgreSQL,
// `npm run e2e:local` on the Local Edition's SQLite file): each module must behave the same on both.

export const orgOf = async (email: string) => (await sql<{ orgId: string }>(`select "orgId" from "User" where email = $1`, [email]))[0]!.orgId;

/** Records an expense on the Expenses screen, as a person does. Amount in rupees. */
export async function addExpense(page: Page, { description, amount }: { description: string; amount: number }) {
  await page.goto("/expenses?do=add");
  await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
  await page.getByLabel("Description").fill(description);
  await page.getByLabel("Amount (₹)").fill(String(amount));
  await page.getByLabel("Payment method").selectOption({ index: 0 });
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText(description).first()).toBeVisible();
}

/** No error screen and no "Something went wrong" on the page. */
export async function noErrorScreen(page: Page) {
  await expect(page.getByText(/Something went wrong|Application error/i)).toHaveCount(0);
}
