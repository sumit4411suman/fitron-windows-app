import { expect, newContext, setPlan, signUp, sql, test } from "./support";

// What a plan opens. The unit tests check the rules; these check that the real pages and download routes of a real gym
// follow them, and that a change of plan is felt at once.

const STARTER_OPEN: [string, string][] = [
  ["/reports/collections/xls", "a basic report, as Excel"],
  ["/reports/collections/csv", "a basic report, as CSV"],
  ["/expenses/csv", "expenses, as CSV"],
];

const PROFESSIONAL_ONLY: [string, string][] = [
  ["/reports/pur-month/xls", "the Purchases report, as Excel"],
  ["/reports/pur-month/csv", "the Purchases report, as CSV"],
  ["/reports/assets/xls", "the Fixed-asset report, as Excel"],
  ["/accounting/csv?kind=pl&from=2026-10-01&to=2026-10-31", "the Accounting profit and loss, as CSV"],
  ["/accounting/csv?kind=income", "the Accounting ledger, as CSV"],
  ["/purchases/csv", "Purchases, as CSV"],
];

test("a Starter gym keeps its own downloads and is refused the ones of a higher plan, until it upgrades", async ({ page }) => {
  const gym = await signUp(page, { plan: "starter", tag: "starter-downloads" });
  const status = async (url: string) => (await page.request.get(url, { maxRedirects: 0 })).status();

  for (const [url, what] of STARTER_OPEN) expect(await status(url), `Starter can download ${what}`).toBe(200);
  for (const [url, what] of PROFESSIONAL_ONLY) expect(await status(url), `Starter is refused ${what}`).toBe(403);

  await setPlan(gym.email, "professional");
  for (const [url, what] of PROFESSIONAL_ONLY) expect(await status(url), `Professional can download ${what}`).toBe(200);
});

test("the Excel downloads are real workbooks, which Excel opens without a warning", async ({ page }) => {
  await signUp(page, { plan: "professional", tag: "xlsx-downloads" });
  for (const url of ["/reports/collections/xls", "/reports/pur-month/xls", "/reports/assets/xls", "/audit/xls"]) {
    const r = await page.request.get(url, { maxRedirects: 0 });
    expect(r.status(), url).toBe(200);
    expect(r.headers()["content-type"], `${url} says it is a workbook`).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.headers()["content-disposition"], `${url} is saved as .xlsx`).toMatch(/filename="[^"]+\.xlsx"/);
    const body = await r.body();
    expect(body.subarray(0, 2).toString(), `${url} is a zip`).toBe("PK");
    for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) expect(body.includes(part), `${url} holds ${part}`).toBe(true);
  }
});

test("the pages of a higher plan are closed to a Starter gym and its menu does not offer them", async ({ page }) => {
  await signUp(page, { plan: "starter", tag: "starter-pages" });
  await page.goto("/purchases");
  await expect(page, "a page the plan does not open does not show its content").not.toHaveURL(/\/purchases$/);
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Purchases", exact: true })).toHaveCount(0);
});

test("priority support is promised to the plans that have it, and only to them", async ({ browser, page }) => {
  await signUp(page, { plan: "enterprise", tag: "priority" });
  await page.goto("/settings?tab=help");
  await expect(page.getByText(/includes priority support/)).toBeVisible();

  const subject = `Priority check ${Date.now()}`;
  await page.locator('input[name="subject"]').fill(subject);
  await page.locator('textarea[name="message"]').fill("Checking that priority plans are marked. This is an automated test.");
  await page.getByRole("button", { name: "Send to support" }).click();
  await expect(page.getByText(subject).first()).toBeVisible();
  const [ticket] = await sql<{ reply: string | null }>(
    `select (select r.text from "SupportTicketReply" r where r."ticketId" = t.id order by r."createdAt" desc limit 1) as reply from "SupportTicket" t where t.subject = $1`,
    [subject],
  );
  expect(ticket?.reply, "the acknowledgement says it is picked up first").toContain("priority-support plans are picked up first");

  // A Starter gym is not told it has it.
  const ctx = await newContext(browser);
  const starter = await ctx.newPage();
  await signUp(starter, { plan: "starter", tag: "no-priority" });
  await starter.goto("/settings?tab=help");
  await expect(starter.getByText("Contact Fitron support").first()).toBeVisible();
  await expect(starter.getByText(/includes priority support/)).toHaveCount(0);
  await ctx.close();
});
