import { writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoicePdfData } from "./invoice";
import { PAPERS, PAPER_LIST, parsePaper, type Paper } from "./paper";
import { renderReceiptPdf, type ReceiptPdfData } from "./receipt";
import type { Rendered } from "./sheet";

// Phase 17: every document on every paper. The PDF's page is the paper's size (a roll as long as its content), every
// line of text sits inside the printable margins, and the document says what it must.
// PRINT_SAMPLES=<folder> also writes the PDFs there, to look at or print.

const gym = {
  name: "Power Haus Gym",
  tagline: "Built Stronger",
  address: "C-7, Sector 4, City Centre\nBokaro Steel City, Jharkhand 827004",
  phone: "7319742490",
  email: "hello@powerhausgym.in",
  gstin: "20ABCDE1234F1Z5",
  sac: "999723",
  instagram: "@powerhausbokaro",
};

const invoice: InvoicePdfData = {
  gym,
  number: "INV-1001",
  date: "11 Oct 2026",
  dueDate: "11 Oct 2026",
  status: "Partly paid",
  member: { name: "Asha Verma", code: "M-101", phone: "9876543210", address: "Flat 12, Shanti Apartments, Sector 4, Bokaro" },
  items: [
    { description: "Gold Quarterly membership (3 months) with personal training induction and locker", qty: 1, rate: 1000000, discount: 50000, taxRate: 18, amount: 1121000 },
    { description: "Protein shake", qty: 2, rate: 15000, discount: 0, taxRate: 18, amount: 35400 },
  ],
  subtotal: 1030000,
  discount: 50000,
  tax: 176400,
  total: 1156400,
  paid: 500000,
  balance: 656400,
  gstType: "CGST+SGST",
  gstRate: 18,
  payments: [
    { code: "PAY-5001", date: "11 Oct 2026", method: "UPI", amount: 500000, reversed: false },
    { code: "PAY-5000", date: "11 Oct 2026", method: "Cash", amount: 100000, reversed: true },
  ],
  membership: { plan: "Gold Quarterly", start: "11 Oct 2026", end: "10 Jan 2027" },
};

const receipt: ReceiptPdfData = {
  gym,
  number: "PAY-5001",
  date: "11 Oct 2026",
  member: { name: "Asha Verma", code: "M-101", phone: "9876543210" },
  amount: 500050,
  method: "UPI",
  txnRef: "412345678901",
  notes: null,
  invoice: { number: "INV-1001", date: "11 Oct 2026", total: 1156400, paidToDate: 500050, balance: 656350 },
  membership: { plan: "Gold Quarterly", start: "11 Oct 2026", end: "10 Jan 2027" },
  items: [{ description: "Gold Quarterly membership", qty: 1, amount: 1121000 }],
  receivedBy: "Ravi Kumar",
  reversed: null,
};

async function pageSizes(r: Rendered) {
  const doc = await PDFDocument.load(r.bytes);
  return doc.getPages().map((p) => {
    const box = p.getMediaBox();
    return { width: box.width, height: box.height };
  });
}

/** What the document says, in the order it was written (a wrapped line stays with the rest of its sentence). */
const said = (r: Rendered) => r.placed.map((p) => p.text).join(" ").replace(/\s+/g, " ");

function save(name: string, r: Rendered) {
  const dir = process.env.PRINT_SAMPLES;
  if (dir) writeFileSync(path.join(dir, `${name}-${r.paper}.pdf`), r.bytes);
}

/** Every piece of text inside the paper's margins (a point of slack for rounding). */
function insideMargins(r: Rendered) {
  const spec = PAPERS[r.paper];
  const out = r.placed.filter((p) => p.x < spec.margin - 1 || p.x + p.width > spec.width - spec.margin + 1);
  return out.map((p) => `"${p.text}" at ${p.x.toFixed(1)}..${(p.x + p.width).toFixed(1)}`);
}

describe.each(PAPER_LIST)("on %s paper", (paper: Paper) => {
  const spec = PAPERS[paper];

  it("prints the GST invoice", async () => {
    const r = await renderInvoicePdf(invoice, paper);
    save("invoice", r);
    const sizes = await pageSizes(r);
    expect(sizes[0]!.width).toBeCloseTo(spec.width, 1);
    if (spec.height) expect(sizes[0]!.height).toBeCloseTo(spec.height, 1);
    else expect(sizes[0]!.height).toBeGreaterThan(300);
    expect(insideMargins(r)).toEqual([]);
    const text = said(r);
    for (const must of ["POWER HAUS GYM", "GSTIN 20ABCDE1234F1Z5", "TAX INVOICE", "INV-1001", "Asha Verma", "CGST (9%)", "SGST (9%)", "₹11,564.00", "₹6,564.00", "Rupees Eleven Thousand Five Hundred Sixty Four only", "PAY-5001", "SAC 999723"]) {
      expect(text, must).toContain(must);
    }
    // The long description is all there, wrapped rather than cut or run into the next column.
    expect(text).toContain("Gold Quarterly membership (3 months) with personal training induction and locker");
  });

  it("prints the payment receipt, which is also the member's receipt", async () => {
    const r = await renderReceiptPdf(receipt, paper);
    save("receipt", r);
    const sizes = await pageSizes(r);
    expect(sizes).toHaveLength(1);
    expect(sizes[0]!.width).toBeCloseTo(spec.width, 1);
    expect(insideMargins(r)).toEqual([]);
    const text = said(r);
    for (const must of ["PAYMENT RECEIPT", "PAY-5001", "Asha Verma", "M-101", "₹5,000.50", "Rupees Five Thousand and Fifty Paise only", "UPI", "412345678901", "INV-1001", "Gold Quarterly membership, 11 Oct 2026 to 10 Jan 2027", "₹6,563.50", "Ravi Kumar"]) {
      expect(text, must).toContain(must);
    }
    expect(text).not.toContain("CANCELLED");
  });

  it("prints a reversed payment as cancelled, never as a valid receipt", async () => {
    const r = await renderReceiptPdf({ ...receipt, reversed: { date: "12 Oct 2026", reason: "Cheque bounced" } }, paper);
    const text = said(r);
    expect(text).toContain("RECEIPT · CANCELLED");
    expect(text).toContain("Cheque bounced");
    expect(text).not.toContain("PAYMENT RECEIPT");
  });
});

describe("paper", () => {
  it("reads the paper asked for, and falls back for anything else", () => {
    expect(parsePaper("a5", "a4")).toBe("a5");
    expect(parsePaper("58mm", "a4")).toBe("58mm");
    expect(parsePaper("letter", "80mm")).toBe("80mm");
    expect(parsePaper(null, "a4")).toBe("a4");
  });

  it("cuts a thermal receipt where it ends, and spreads a long invoice over A4 pages", async () => {
    const short = await renderReceiptPdf({ ...receipt, txnRef: null }, "80mm");
    const [roll] = await pageSizes(short);
    expect(roll!.height).toBeLessThan(900);
    const many = { ...invoice, items: Array.from({ length: 60 }, (_, i) => ({ ...invoice.items[1]!, description: `Item ${i + 1}` })) };
    const r = await renderInvoicePdf(many, "a4");
    const pages = (await pageSizes(r)).length;
    expect(pages).toBeGreaterThan(1);
    expect(said(r)).toContain("Item 60");
    // The column headings repeat at the top of every page.
    expect(r.placed.filter((p) => p.text === "Description").map((p) => p.page)).toEqual(Array.from({ length: pages }, (_, i) => i + 1));
  });
});
