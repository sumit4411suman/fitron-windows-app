import { addMember, createPlan, expect, signUp, sql, test, unique } from "../support";

// Phase 22: memberships (both editions). A plan runs from its start to the day before the same date a plan-length
// later; a renewal starts the day after the current one ends; a sale over days already paid for is refused.
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

test("a membership's dates, a renewal from the day after it ends, and no paying twice for the same days", async ({ page }) => {
  await signUp(page, { tag: "membership" });
  await createPlan(page, { name: `Quarterly ${unique()}`, months: 3, price: 2700 });
  const memberId = await addMember(page, `Renewing ${unique()}`);
  const today = istToday();

  await page.goto(`/members/${memberId}/sell`);
  await page.getByRole("button", { name: "Create membership" }).click();
  await page.waitForURL(/\/invoices\//);
  const [first] = await sql<{ startDate: unknown; endDate: unknown }>(`select "startDate", "endDate" from "Membership" where "memberId" = $1`, [memberId]);
  expect([day(first!.startDate), day(first!.endDate)]).toEqual([today, addDays(addMonths(today, 3), -1)]);

  // Renewing: the form starts the new plan the day after this one ends.
  await page.goto(`/members/${memberId}/sell`);
  await expect(page.getByRole("button", { name: "Renew and generate invoice" })).toBeVisible();
  await page.getByRole("button", { name: "Renew and generate invoice" }).click();
  await page.waitForURL(/\/invoices\//);
  const ships = await sql<{ startDate: unknown; endDate: unknown }>(`select "startDate", "endDate" from "Membership" where "memberId" = $1 order by "startDate"`, [memberId]);
  expect(ships).toHaveLength(2);
  expect(day(ships[1]!.startDate)).toBe(addDays(day(first!.endDate), 1));

  // A third plan starting today would bill days already paid for.
  await page.goto(`/members/${memberId}/sell`);
  await page.getByLabel("Start date").fill(today);
  await page.getByRole("button", { name: "Renew and generate invoice" }).click();
  await expect(page.getByText(/already has .* covering .*; the new plan would overlap it/).first()).toBeVisible();
  expect(await sql(`select 1 from "Membership" where "memberId" = $1`, [memberId])).toHaveLength(2);
});
