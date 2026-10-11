import { writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { addMember, sell } from "../support";
import { startLocalServer, type LocalServer } from "../local/server";

// Phase 20 (npm run perf:local): FITRON for Windows on the performance dataset (perf/seed.perf.ts: 5,000 members,
// 20,000 memberships, 50,000 invoices, 100,000 payments, 20,000 expenses, 200,000 audit entries), the production build,
// one browser. Every screen a desk uses daily is opened and timed until its content is on screen; each must stay under
// its budget. The numbers go to perf-results.json and docs/local-windows/PERFORMANCE.md.

test.skip(process.env.E2E_PERF !== "1", "npm run perf:local runs this, on its own dataset");
test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

const PORT = 3410;
const root = process.env.PERF_ROOT!;
const OWNER = { email: "owner@perf.fitron.test", password: "Perf-owner-password-1" };
/** Milliseconds. A desk notices a second; these are what a modest gym PC must stay under (CI is slower than a desk PC). */
const BUDGET = { start: 20_000, screen: 3_000, report: 6_000, sale: 6_000, pdf: 3_000 };

const results: { what: string; ms: number; budget: number }[] = [];
let server: LocalServer;
let page: Page;

async function timed(what: string, budget: number, fn: () => Promise<unknown>) {
  const t = Date.now();
  await fn();
  const ms = Date.now() - t;
  results.push({ what, ms, budget });
  test.info().annotations.push({ type: what, description: `${ms} ms (budget ${budget} ms)` });
  return ms;
}

/** Opens a screen and waits for its content: the heading, or a given text. */
const screen = (url: string, ready: (p: Page) => ReturnType<Page["getByRole"]>) => async () => {
  await page.goto(url);
  await expect(ready(page).first()).toBeVisible({ timeout: 60_000 });
};

test.beforeAll(async ({ browser }) => {
  await timed("Start the server on the full dataset", BUDGET.start, async () => {
    server = await startLocalServer(root, PORT);
  });
  const ctx = await browser.newContext({ baseURL: server.url, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${OWNER.email}`);
  page = await ctx.newPage();
});

test.afterAll(async () => {
  writeFileSync(path.join(root, "perf-results.json"), JSON.stringify(results, null, 2));
  await server?.stop();
});

test("every daily screen opens within its budget on a gym with years of records", async () => {
  await timed("Sign in", BUDGET.screen, async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });
  const h = (name: string | RegExp) => (p: Page) => p.getByRole("heading", { name });
  const screens: [string, string, (p: Page) => ReturnType<Page["getByRole"]>, number][] = [
    ["Dashboard", "/dashboard", (p) => p.getByRole("main"), BUDGET.screen],
    ["Members list", "/members", h(/Members/), BUDGET.screen],
    ["Member search by name", "/members?q=Sharma", (p) => p.getByRole("link", { name: /Sharma/ }), BUDGET.screen],
    ["Member search by phone", "/members?q=9700001234", (p) => p.getByText("9700001234"), BUDGET.screen],
    ["Invoices", "/invoices", h(/Invoices/), BUDGET.screen],
    ["Payments", "/payments", h(/Payments/), BUDGET.screen],
    ["Receivables", "/receivables", h(/Receivables|Dues/), BUDGET.screen],
    ["Renewals", "/renewals", h(/Renewals/), BUDGET.screen],
    ["Expenses", "/expenses", h(/Expenses/), BUDGET.screen],
    ["Attendance", "/attendance", h(/Attendance/), BUDGET.screen],
    ["Audit log", "/audit", h(/Audit/), BUDGET.screen],
    ["Profit & loss", "/accounting", h(/Accounting/), BUDGET.report],
    ["Ledgers", "/accounting?tab=ledger", h(/Accounting/), BUDGET.report],
    ["GST report", "/reports/gst", h(/GST/), BUDGET.report],
    ["Collections report", "/reports/collections", h(/Collections|collect/i), BUDGET.report],
    ["Dues report", "/reports/dues", h(/Dues|Receivable/i), BUDGET.report],
    ["Revenue by month", "/reports/rev-month", h(/Revenue/), BUDGET.report],
    ["Members by plan", "/reports/m-plan", h(/plan/i), BUDGET.report],
    ["Reports centre", "/reports", h(/Reports/), BUDGET.screen],
  ];
  for (const [what, url, ready, budget] of screens) await timed(what, budget, screen(url, ready));

  // A sale on the full books: a new member, a membership and its invoice, then the invoice's PDF.
  let invoiceId = "";
  await timed("Add a member", BUDGET.sale, async () => {
    const id = await addMember(page, "Perf New Member");
    await timed("Sell a membership, invoice and payment", BUDGET.sale, async () => {
      invoiceId = await sell(page, id, { payNow: 500 });
    });
  });
  await timed("Invoice PDF", BUDGET.pdf, async () => {
    const head = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return { status: r.status, start: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 5)) };
    }, `/invoices/${invoiceId}/pdf`);
    expect(head).toEqual({ status: 200, start: "%PDF-" });
  });
  // The invoice number continues the series past 50,000 invoices.
  await page.goto(`/invoices/${invoiceId}`);
  await expect(page.getByRole("heading", { name: /INV-5\d{4}/ })).toBeVisible();

  const over = results.filter((r) => r.ms > r.budget);
  expect(over, "screens over budget").toEqual([]);
});
