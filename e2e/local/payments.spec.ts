import { addMember, createPlan, expect, signUp, sell, sql, test, unique } from "../support";

// Phase 22: payments (both editions). Kept in paise to the last one, numbered one after another, never past what is
// owed, and the invoice settles when the last paisa comes in. The gym charges GST, so the total has paise of its own.
test("part payments in paise, a payment past the balance refused, the last one settles the invoice", async ({ page }) => {
  await signUp(page, { tag: "payments" });
  await createPlan(page, { name: `Plan ${unique()}`, months: 1, price: 1999.99 });
  const invoiceId = await sell(page, await addMember(page, `Payer ${unique()}`), { payNow: 0 });
  const [inv] = await sql<{ total: number; tax: number }>(`select total, tax from "Invoice" where id = $1`, [invoiceId]);
  expect(inv!.total).toBe(199999 + inv!.tax);
  const rest = inv!.total - 100025;

  const pay = async (amount: string, method = "UPI", ref = "") => {
    await page.goto(`/invoices/${invoiceId}`);
    await page.getByLabel("Amount (₹)").fill(amount);
    await page.getByLabel("Method").selectOption(method);
    if (ref) await page.getByLabel("Reference").fill(ref);
    await page.getByRole("button", { name: "Record payment" }).click();
  };
  await pay("1000.25", "UPI", "UPI-REF-778899");
  await page.waitForURL(/receipt=/);
  await pay("5000", "Cash");
  await expect(page.getByText(`The balance is only ₹${(rest / 100).toLocaleString("en-IN")}.`).first()).toBeVisible();
  await pay((rest / 100).toFixed(2), "Cash");
  await page.waitForURL(/receipt=/);
  await expect(page.getByText("PAID", { exact: true })).toBeVisible();

  const pays = await sql<{ code: string; amount: number; method: string; txnRef: string | null }>(`select code, amount, method, "txnRef" from "Payment" where "invoiceId" = $1 order by "createdAt"`, [invoiceId]);
  expect(pays.map((p) => [p.amount, p.method, p.txnRef])).toEqual([
    [100025, "UPI", "UPI-REF-778899"],
    [rest, "Cash", null],
  ]);
  const [a, b] = pays.map((p) => Number(p.code.replace(/\D/g, "")));
  expect(b, "receipt numbers one after another").toBe(a! + 1);
});
