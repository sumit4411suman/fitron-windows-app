import { addMember, expect, gymWithPlan, sell, sql, sqlError, test, unique } from "./support";

// The thing FITRON is for: a member buys a plan, an invoice is made with the right GST, the money is recorded, and none
// of it can be lost afterwards. Everything here is done on the screens a front-desk person uses.

test("a membership sale: GST worked out, invoice and PDF made, payment recorded, and the record cannot be deleted", async ({ page }) => {
  const plan = { name: `Quarterly ${unique()}`, months: 3, price: 1500 };
  await gymWithPlan(page, plan);
  const member = `Asha ${unique()}`;
  const memberId = await addMember(page, member);

  const invoiceId = await sell(page, memberId);
  await expect(page.getByText("Invoice created.")).toBeVisible();
  // The arithmetic on the Gym GST Billing page of the website: ₹1,500 + CGST 9% + SGST 9% = ₹1,770.
  const invoice = page.locator("main");
  await expect(invoice).toContainText("CGST 9%");
  await expect(invoice).toContainText("SGST 9%");
  await expect(invoice.getByText("₹135").first()).toBeVisible();
  await expect(invoice.getByText("₹1,770").first()).toBeVisible();
  await expect(invoice.getByText("PAID", { exact: true })).toBeVisible();

  const pdf = await page.request.get(`/invoices/${invoiceId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto("/payments");
  await expect(page.getByText(member).first()).toBeVisible();
  await expect(page.getByText("₹1,770").first()).toBeVisible();
  await page.goto(`/members/${memberId}`);
  await expect(page.getByText(plan.name).first()).toBeVisible();

  const [row] = await sql<{ subtotal: number; tax: number; total: number; paid: number }>(`select subtotal, tax, total, (select coalesce(sum(amount), 0)::int from "Payment" p where p."invoiceId" = i.id) as paid from "Invoice" i where i.id = $1`, [invoiceId]);
  expect(row, "stored in paise").toMatchObject({ subtotal: 150_000, tax: 27_000, total: 177_000, paid: 177_000 });

  // The books: the database itself refuses to lose a payment or an invoice, whoever asks.
  expect(await sqlError(`delete from "Payment" where "invoiceId" = '${invoiceId}'`)).toMatch(/not allowed/);
  expect(await sqlError(`delete from "Invoice" where id = '${invoiceId}'`)).toMatch(/not allowed/);
  expect((await sql(`select 1 from "Payment" where "invoiceId" = $1`, [invoiceId])).length, "the payment is still there").toBe(1);
});

test("a part payment leaves a balance that shows as outstanding, and collecting it settles the invoice", async ({ page }) => {
  await gymWithPlan(page, { name: `Monthly ${unique()}`, months: 1, price: 1000 });
  const member = `Ravi ${unique()}`;
  const memberId = await addMember(page, member);

  const invoiceId = await sell(page, memberId, { payNow: 500 });
  await expect(page.getByText("PART PAID", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("₹680").first(), "₹1,180 with GST, less ₹500 paid").toBeVisible();

  await page.goto("/receivables");
  await expect(page.getByText(member).first(), "the member owes money").toBeVisible();

  await page.goto(`/invoices/${invoiceId}`);
  await page.locator("#collect").getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("PAID", { exact: true })).toBeVisible();
  const [row] = await sql<{ paid: number; total: number }>(`select total, (select coalesce(sum(amount), 0)::int from "Payment" p where p."invoiceId" = i.id) as paid from "Invoice" i where i.id = $1`, [invoiceId]);
  expect(row?.paid).toBe(row?.total);

  await page.goto("/receivables");
  await expect(page.getByText(member), "and no longer owes it").toHaveCount(0);
});

test("a payment taken by mistake is reversed, never deleted: the record stays and the balance returns", async ({ page }) => {
  await gymWithPlan(page, { name: `Weekly ${unique()}`, months: 1, price: 800 });
  const memberId = await addMember(page, `Meera ${unique()}`);
  const invoiceId = await sell(page, memberId);
  await expect(page.getByText("PAID", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reverse", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Reverse this payment?" });
  await ask.getByLabel("Reason").fill("Entered against the wrong member");
  await ask.getByRole("button", { name: "Reverse", exact: true }).click();
  await expect(page.getByText("PAID", { exact: true })).toHaveCount(0);

  const rows = await sql<{ n: number; reversed: number }>(`select count(*)::int as n, count(*) filter (where status = 'REVERSED')::int as reversed from "Payment" where "invoiceId" = $1`, [invoiceId]);
  expect(rows[0], "the payment is kept, marked as reversed").toEqual({ n: 1, reversed: 1 });
});

test("recording ₹0 says what is wrong instead of hanging on Saving…", async ({ page }) => {
  await gymWithPlan(page, { name: `Zero ${unique()}`, months: 1, price: 1000 });
  const memberId = await addMember(page, `Zero ${unique()}`);
  const invoiceId = await sell(page, memberId, { payNow: 0 });
  await page.goto(`/invoices/${invoiceId}`);
  const collect = page.locator("#collect");
  await collect.getByLabel("Amount (₹)").fill("0");
  await collect.getByRole("button", { name: "Record payment" }).click();
  await expect(collect.getByText(/Enter an amount/).first()).toBeVisible();
  await expect(collect.getByRole("button", { name: "Record payment" })).toBeEnabled();
  expect((await sql(`select 1 from "Payment" where "invoiceId" = $1`, [invoiceId])).length).toBe(0);
});

test("a payment is reversed from the payments list in the app's own dialog, with the reason in view", async ({ page }) => {
  await gymWithPlan(page, { name: `List ${unique()}`, months: 1, price: 900 });
  const member = `Kiran ${unique()}`;
  const memberId = await addMember(page, member);
  const invoiceId = await sell(page, memberId);
  await page.goto("/payments");
  let browserBox = false;
  page.on("dialog", (d) => {
    browserBox = true;
    void d.dismiss();
  });
  await page.getByRole("row").filter({ hasText: member }).getByRole("button", { name: "Reverse" }).click();
  const ask = page.getByRole("dialog", { name: "Reverse this payment?" });
  await expect(ask.getByLabel("Reason")).toBeInViewport();
  await ask.getByLabel("Reason").fill("Wrong member");
  await ask.getByRole("button", { name: "Reverse", exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: member })).toContainText("Reversed");
  expect(browserBox, "no browser confirm box").toBe(false);
  expect((await sql<{ status: string }>(`select status from "Payment" where "invoiceId" = $1`, [invoiceId]))[0]?.status).toBe("REVERSED");
});
