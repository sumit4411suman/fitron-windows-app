import { PDFDocument } from "pdf-lib";
import { addMember, expect, gymWithPlan, sell, test, unique } from "../support";

// Phase 17: printing at the desk. The invoice and every payment's receipt print as PDFs made for the paper chosen
// (A4, A5, 80 mm or 58 mm thermal), not as a printout of the screen, and the paper chosen is remembered. Runs on both
// editions (npm run e2e, npm run e2e:local).

const WIDTH = { a4: 595.28, a5: 419.53, "80mm": 226.77, "58mm": 164.41 } as const;

async function pdfWidth(page: import("@playwright/test").Page, href: string) {
  const res = await page.request.get(href);
  expect(res.status(), href).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  const doc = await PDFDocument.load(await res.body());
  return doc.getPage(0).getWidth();
}

test("the invoice and each payment's receipt print on the paper chosen", async ({ page }) => {
  const plan = { name: `Quarterly ${unique()}`, months: 3, price: 1500 };
  await gymWithPlan(page, plan);
  const memberId = await addMember(page, `Printing ${unique()}`);
  // ₹1,770 with GST; ₹500 now, the rest later.
  const invoiceId = await sell(page, memberId, { payNow: 500 });

  // The invoice: A4 unless another paper is chosen; the choice is kept for the next invoice.
  const print = page.getByRole("link", { name: "Print invoice" });
  await expect(print).toHaveAttribute("href", `/invoices/${invoiceId}/pdf?paper=a4`);
  await expect(print).toHaveAttribute("target", "_blank");
  await page.getByLabel("Print invoice: paper").selectOption("a5");
  await expect(print).toHaveAttribute("href", `/invoices/${invoiceId}/pdf?paper=a5`);
  await page.reload();
  await expect(page.getByRole("link", { name: "Print invoice" })).toHaveAttribute("href", `/invoices/${invoiceId}/pdf?paper=a5`);
  for (const paper of ["a4", "a5", "80mm", "58mm"] as const) expect(await pdfWidth(page, `/invoices/${invoiceId}/pdf?paper=${paper}`), paper).toBeCloseTo(WIDTH[paper], 1);
  const saved = await page.request.get(`/invoices/${invoiceId}/pdf?paper=a4&download=1`);
  expect(saved.headers()["content-disposition"]).toMatch(/^attachment; filename="INV-\d+\.pdf"$/);

  // The receipt for the payment taken with the sale, on a thermal roll by default.
  const receipt = page.getByRole("link", { name: "Print receipt" });
  await expect(receipt).toHaveAttribute("href", /\/payments\/[^/]+\/receipt\?paper=80mm$/);
  expect(await pdfWidth(page, (await receipt.getAttribute("href"))!)).toBeCloseTo(WIDTH["80mm"], 1);

  // Collecting the balance offers its receipt at once.
  await page.getByLabel("Amount (₹)").fill("1270");
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.waitForURL(/\?receipt=/);
  await expect(page.getByText(/Payment recorded \(PAY-/)).toBeVisible();
  const offered = page.getByRole("link", { name: /^Receipt PAY-/ }).first();
  const href = (await offered.getAttribute("href"))!;
  expect(href).toMatch(/\/payments\/[^/]+\/receipt\?paper=80mm$/);
  for (const paper of ["80mm", "58mm", "a5", "a4"] as const) expect(await pdfWidth(page, href.replace("80mm", paper)), paper).toBeCloseTo(WIDTH[paper], 1);

  // The payments list has a receipt for every payment.
  await page.goto("/payments");
  await expect(page.getByRole("link", { name: /^Receipt PAY-/ }).first()).toBeVisible();

  // Someone else's receipt is not found, not printed.
  const other = await page.request.get(`/payments/not-a-payment/receipt`);
  expect(other.status()).toBe(404);
});
