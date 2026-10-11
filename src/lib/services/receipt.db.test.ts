import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { createPlan } from "./plans";
import { collectPayment, reversePayment, sellMembership } from "./billing";
import { invoicePdf, receiptPdf } from "./invoice-pdf";
import { todayIso } from "./time";

// Phase 17: receipts and invoices printed from the real books. A receipt says what was due after it was given, a
// reversed payment prints as cancelled and counts for nothing, and another gym cannot print this gym's documents.

const said = (lines: string[]) => lines.join(" ").replace(/\s+/g, " ");

describe.skipIf(!hasDb)("printing receipts and invoices (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let planId: string;
  const today = todayIso();

  beforeAll(async () => {
    vi.stubEnv("STORAGE_DIR", mkdtempSync(path.join(tmpdir(), "fitron-receipt-")));
    vi.stubEnv("S3_BUCKET", "");
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    // ₹4,000 a quarter + 18% GST = ₹4,720.
    planId = (await createPlan(admin, { name: "Quarterly", kind: "Membership", months: 3, price: 400000, regFee: 0, discount: 0, gstApplicable: true, features: [] })).id;
  });

  it("prints each part payment's receipt with what was still due after it", async () => {
    const m = await createMember(admin, { name: "Receipt Member", gender: "Female", phone: "9811188001", source: "Walk-in", tags: [] });
    const { invoice } = await sellMembership(admin, m.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 200000, payMethod: "UPI" });
    const second = await collectPayment(admin, invoice.id, { amount: 272000, method: "Cash", date: today, txnRef: "CASH-77" });
    const first = (await receiptPdf(admin, (await invoicePdf(admin, invoice.id))!.invoice.payments[0]!.id))!;
    const firstText = said(first.lines);
    expect(firstText).toContain("PAYMENT RECEIPT");
    expect(firstText).toContain(first.payment.code);
    expect(firstText).toContain("Receipt Member");
    expect(firstText).toContain("₹2,000.00");
    expect(firstText).toContain("Rupees Two Thousand only");
    expect(firstText).toContain("Quarterly membership");
    expect(firstText).toMatch(/Paid to date ₹2,000\.00/);
    expect(firstText).toMatch(/Balance due ₹2,720\.00/);

    const last = (await receiptPdf(admin, second.id, "a5"))!;
    const lastText = said(last.lines);
    expect(last.filename).toBe(`${second.code}-a5.pdf`);
    expect(lastText).toContain("₹2,720.00");
    expect(lastText).toContain("CASH-77");
    expect(lastText).toMatch(/Paid to date ₹4,720\.00/);
    expect(lastText).toMatch(/Balance due ₹0\.00/);
    const doc = await PDFDocument.load(last.bytes);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(419.53, 1);
  });

  it("prints a reversed payment as cancelled, and leaves it out of later receipts' totals", async () => {
    const m = await createMember(admin, { name: "Reversal Member", gender: "Male", phone: "9811188002", source: "Walk-in", tags: [] });
    const { invoice } = await sellMembership(admin, m.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 100000, payMethod: "Bank Transfer" });
    const firstId = (await invoicePdf(admin, invoice.id))!.invoice.payments[0]!.id;
    await reversePayment(admin, firstId, "Transfer returned by the bank");
    const again = await collectPayment(admin, invoice.id, { amount: 472000, method: "UPI", date: today });

    const cancelled = said((await receiptPdf(admin, firstId))!.lines);
    expect(cancelled).toContain("RECEIPT · CANCELLED");
    expect(cancelled).toContain("Transfer returned by the bank");
    expect(cancelled).not.toContain("PAYMENT RECEIPT");

    const valid = said((await receiptPdf(admin, again.id))!.lines);
    expect(valid).toMatch(/Paid to date ₹4,720\.00/);
    expect(valid).toMatch(/Balance due ₹0\.00/);
  });

  it("prints the invoice on every paper", async () => {
    const m = await createMember(admin, { name: "Paper Member", gender: "Female", phone: "9811188003", source: "Walk-in", tags: [] });
    const { invoice } = await sellMembership(admin, m.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 0 });
    for (const [paper, width] of [["a4", 595.28], ["a5", 419.53], ["80mm", 226.77], ["58mm", 164.41]] as const) {
      const pdf = (await invoicePdf(admin, invoice.id, paper))!;
      expect((await PDFDocument.load(pdf.bytes)).getPage(0).getWidth(), paper).toBeCloseTo(width, 1);
      expect(said(pdf.lines), paper).toContain(invoice.number);
    }
  });

  it("prints nothing for another gym", async () => {
    const m = await createMember(admin, { name: "Private Member", gender: "Male", phone: "9811188004", source: "Walk-in", tags: [] });
    const { invoice } = await sellMembership(admin, m.id, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 50000, payMethod: "UPI" });
    const paymentId = (await invoicePdf(admin, invoice.id))!.invoice.payments[0]!.id;
    const other = await makeGym();
    const stranger = pick(await other.user("Super Admin"), other.a.id);
    expect(await receiptPdf(stranger, paymentId)).toBeNull();
    expect(await invoicePdf(stranger, invoice.id)).toBeNull();
  });
});
