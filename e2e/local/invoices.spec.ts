import { addMember, createPlan, expect, signUp, sell, sql, test, unique } from "../support";

// Phase 22: invoices (both editions). A cancelled invoice keeps its number and its record; its payments are reversed
// and its membership cancelled, all with the reason; the next invoice takes the next number, never the cancelled one;
// and the cancelled invoice's PDF still opens.
test("cancelling an invoice reverses its payments, cancels its membership and never frees its number", async ({ page }) => {
  await signUp(page, { tag: "invoices" });
  await createPlan(page, { name: `Plan ${unique()}`, months: 1, price: 1500 });
  const memberId = await addMember(page, `Invoiced ${unique()}`);
  const first = await sell(page, memberId, { payNow: 500 });

  await page.goto(`/invoices/${first}`);
  await page.getByRole("button", { name: "Cancel invoice", exact: true }).click();
  const ask = page.getByRole("dialog", { name: /Cancel this invoice\?/ });
  await ask.getByLabel("Reason").fill("Sold the wrong plan");
  await ask.getByRole("button", { name: "Cancel invoice", exact: true }).click();
  await expect.poll(async () => (await sql<{ status: string }>(`select status from "Invoice" where id = $1`, [first]))[0]!.status).toBe("CANCELLED");
  await page.reload();
  await expect(page.getByText("CANCELLED", { exact: true }).first()).toBeVisible();

  const [inv] = await sql<{ number: string; status: string; cancelReason: string }>(`select number, status, "cancelReason" from "Invoice" where id = $1`, [first]);
  expect(inv).toMatchObject({ status: "CANCELLED", cancelReason: "Sold the wrong plan" });
  expect(await sql(`select status from "Payment" where "invoiceId" = $1`, [first])).toEqual([{ status: "REVERSED" }]);
  expect(await sql(`select status from "Membership" where "invoiceId" = $1`, [first])).toEqual([{ status: "CANCELLED" }]);

  const second = await sell(page, memberId, { payNow: 0 });
  const [next] = await sql<{ number: string }>(`select number from "Invoice" where id = $1`, [second]);
  expect(Number(next!.number.replace(/\D/g, ""))).toBe(Number(inv!.number.replace(/\D/g, "")) + 1);

  // The cancelled invoice is still a document of the books.
  const pdf = await page.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, start: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 5)) };
  }, `/invoices/${first}/pdf`);
  expect(pdf).toEqual({ status: 200, start: "%PDF-" });
});
