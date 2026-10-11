import { addMember, expect, gymWithPlan, sql, test, unique } from "./support";

// Fitron AI as an accounting assistant. The model's reply is the one thing stubbed here (it needs a paid key and a network);
// the draft it asks for, the card the person sees, the Confirm button, the server action and the invoice it books are all real.

const NDJSON = (events: object[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

test("Fitron AI drafts an invoice, nothing is booked until Confirm, then the GST invoice exists with a PDF link", async ({ page }) => {
  const gym = await gymWithPlan(page, { name: `Monthly ${unique()}`, months: 1, price: 1000 });
  const name = `Asha ${unique()}`;
  const memberId = await addMember(page, name);
  const [{ orgId, userId }] = await sql<{ orgId: string; userId: string }>(`select "orgId", id as "userId" from "User" where email = $1`, [gym.email]);

  // What the draft_invoice tool stores: ₹1,500 × 2 of personal training, GST 18% = ₹3,540.
  const id = `e2e${unique()}`;
  const preview = [`Invoice for ${name}`, "1. Personal training: 2 × ₹1,500.00 = ₹3,000.00, GST 18% ₹540.00", "Subtotal ₹3,000.00 · GST ₹540.00 (18% CGST+SGST) · Total ₹3,540.00", "Nothing received now; ₹3,540.00 due today"].join("\n");
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const payload = { input: { memberId, date: today, dueDate: today, lines: [{ description: "Personal training", category: "Personal Training", qty: 2, rate: 150_000, discount: 0, taxable: true }], payAmount: 0 } };
  await sql(`insert into "AiProposal" (id, "orgId", "userId", kind, "memberIds", body, summary, payload) values ($1, $2, $3, 'INVOICE', $4, $5, 'Create invoice of ₹3,540.00', $6)`, [id, orgId, userId, [memberId], preview, JSON.stringify(payload)]);

  await page.route("**/api/ai/chat", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: NDJSON([
        { type: "tool", name: "draft_invoice" },
        { type: "proposal", id, kind: "INVOICE", summary: "Create invoice of ₹3,540.00", members: 1, body: preview, confirm: "Create invoice" },
        { type: "text", text: "Ready: ₹3,540 including GST. Check it and press Confirm." },
        { type: "done" },
      ]),
    }),
  );

  await page.goto("/ai");
  await expect(page.getByText("accounting assistant", { exact: false }).first()).toBeVisible();
  await page.getByLabel("Ask Fitron AI").fill(`Make a bill for ${name}, 2 PT sessions at 1500`);
  await page.getByRole("button", { name: "Send" }).click();

  const card = page.getByText("Subtotal ₹3,000.00 · GST ₹540.00");
  await expect(card).toBeVisible();
  await expect(page.getByText("Ready: ₹3,540 including GST")).toBeVisible();
  expect(await sql(`select 1 from "Invoice" where "memberId" = $1`, [memberId]), "nothing is booked before Confirm").toHaveLength(0);

  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByText(/Invoice .+ created, total ₹3,540\.00/)).toBeVisible();
  const [inv] = await sql<{ id: string; number: string; tax: number; total: number }>(`select id, number, tax, total from "Invoice" where "memberId" = $1`, [memberId]);
  expect(inv).toMatchObject({ tax: 54_000, total: 354_000 });
  expect((await sql(`select status from "AiProposal" where id = $1`, [id]))[0]).toMatchObject({ status: "DONE" });

  // The PDF link in the chat opens the invoice the app made.
  const pdfHref = await page.getByRole("link", { name: "Invoice PDF" }).getAttribute("href");
  expect(pdfHref).toBe(`/invoices/${inv.id}/pdf`);
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.getByRole("link", { name: "Open", exact: true }).click();
  await page.waitForURL(`**/invoices/${inv.id}`);
  await expect(page.locator("main")).toContainText("₹3,540");
});

test("a draft that is discarded books nothing", async ({ page }) => {
  const gym = await gymWithPlan(page, { name: `Monthly ${unique()}`, months: 1, price: 1000 });
  const memberId = await addMember(page, `Ravi ${unique()}`);
  const [{ orgId, userId }] = await sql<{ orgId: string; userId: string }>(`select "orgId", id as "userId" from "User" where email = $1`, [gym.email]);
  const id = `e2e${unique()}`;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const payload = { input: { memberId, date: today, dueDate: today, lines: [{ description: "Shaker", category: "Product", qty: 1, rate: 50_000, discount: 0, taxable: true }], payAmount: 0 } };
  await sql(`insert into "AiProposal" (id, "orgId", "userId", kind, "memberIds", body, summary, payload) values ($1, $2, $3, 'INVOICE', $4, 'Invoice for Ravi', 'Create invoice of ₹590.00', $5)`, [id, orgId, userId, [memberId], JSON.stringify(payload)]);
  await page.route("**/api/ai/chat", (route) =>
    route.fulfill({ contentType: "application/x-ndjson", body: NDJSON([{ type: "proposal", id, kind: "INVOICE", summary: "Create invoice of ₹590.00", members: 1, body: "Invoice for Ravi", confirm: "Create invoice" }, { type: "done" }]) }),
  );
  await page.goto("/ai");
  await page.getByLabel("Ask Fitron AI").fill("bill Ravi for a shaker");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Discarded. Nothing was saved.")).toBeVisible();
  expect(await sql(`select 1 from "Invoice" where "memberId" = $1`, [memberId])).toHaveLength(0);
  expect((await sql(`select status from "AiProposal" where id = $1`, [id]))[0]).toMatchObject({ status: "DISMISSED" });
});

test("asking from the Ask Fitron AI drawer works in browsers whose scrollIntoView returns a promise", async ({ page }) => {
  // Newer Chrome returns a promise from scroll methods. The chat scrolls to its last message in an effect, and an effect that
  // returned that promise made React call it as the cleanup on the next answer: "TypeError: i is not a function", and the
  // whole console showed the error page.
  await page.addInitScript(() => {
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, ...args: Parameters<Element["scrollIntoView"]>) {
      scroll.apply(this, args);
      return Promise.resolve() as unknown as void;
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await gymWithPlan(page, { name: `Monthly ${unique()}`, months: 1, price: 1000 });
  await page.route("**/api/ai/chat", (route) => route.fulfill({ contentType: "application/x-ndjson", body: NDJSON([{ type: "text", text: "You have no dues today." }, { type: "done" }]) }));
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Ask Fitron AI" }).click();
  for (const q of ["Any dues for Asha today?", "And for the rest of the month?"]) {
    await page.getByLabel("Ask Fitron AI").fill(q);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(q)).toBeVisible();
  }
  await expect(page.getByText("You have no dues today.").last()).toBeVisible();
  await expect(page.getByText("This page hit a problem")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("chats are saved to History, reopen, and delete; a file can be attached to a question", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await gymWithPlan(page, { name: `Monthly ${unique()}`, months: 1, price: 1000 });
  await page.goto("/ai");

  // A question through the real route (no model key here, so the built-in answers reply) is saved as a chat.
  const q = `How many members are active ${unique()}?`;
  await page.getByLabel("Ask Fitron AI").fill(q);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByText(q)).toBeVisible();

  // A file goes with the next question; only its name stays in the chat.
  await page.getByLabel("Attach a PDF, photo, Excel or Word file").click();
  await page.locator('input[type="file"]').setInputFiles({ name: "dues.csv", mimeType: "text/csv", buffer: Buffer.from("member,due\nAsha,1180") });
  await expect(page.getByRole("button", { name: "Remove dues.csv" })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Reading attached files needs Fitron AI's model")).toBeVisible();
  await expect(page.getByText("dues.csv")).toBeVisible();

  // New chat clears the screen; History brings the saved one back.
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText(q)).toHaveCount(0);
  await page.getByRole("button", { name: "History" }).click();
  const saved = new RegExp(`^${q.replace(/[?]/g, "\\?")}`);
  await page.getByRole("button", { name: saved }).click();
  await expect(page.getByText(q)).toBeVisible();
  await expect(page.getByText("dues.csv")).toBeVisible();

  // Delete asks first, then removes it for good.
  await page.getByRole("button", { name: "History" }).click();
  await page.getByRole("button", { name: `Delete chat: ${q}` }).click();
  await expect(page.getByText("Delete this chat?")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("button", { name: saved })).toHaveCount(0);
  await expect(page.getByText("No saved chats yet.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("No saved chats yet.")).toBeVisible();
  expect(errors).toEqual([]);
});
