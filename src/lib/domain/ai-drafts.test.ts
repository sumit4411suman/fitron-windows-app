import { describe, expect, it } from "vitest";
import { cancelPreview, CONFIRM_LABEL, DRAFT_KINDS, DRAFT_TTL_MS, draftExpired, expensePreview, invoicePreview, isDraftKind, paise, paymentPreview, problemText, reversePreview, rupeeText, salePreview } from "./ai-drafts";

describe("amounts the model passes", () => {
  it("turns rupees into whole paise", () => {
    expect(paise(1499.5)).toBe(149950);
    expect(paise("₹1,499.50")).toBe(149950);
    expect(paise(0.1 + 0.2)).toBe(30);
    expect(paise(0)).toBe(0);
  });
  it("refuses what isn't a sensible amount", () => {
    for (const v of [-1, NaN, Infinity, "abc", "", null, undefined, {}, 1_000_000_000]) expect(paise(v), String(v)).toBeNull();
  });
  it("gives the text the form schemas read", () => {
    expect(rupeeText(1500)).toBe("1500.00");
    expect(rupeeText("x")).toBeNull();
  });
});

describe("drafts", () => {
  it("know every kind, and each has a button", () => {
    for (const k of DRAFT_KINDS) expect(CONFIRM_LABEL[k], k).toBeTruthy();
    expect(isDraftKind("INVOICE")).toBe(true);
    expect(isDraftKind("WHATSAPP")).toBe(false);
  });
  it("go stale after two hours", () => {
    const t = new Date("2026-10-06T10:00:00Z");
    expect(draftExpired(t, t.getTime() + DRAFT_TTL_MS)).toBe(false);
    expect(draftExpired(t, t.getTime() + DRAFT_TTL_MS + 1)).toBe(true);
  });
});

describe("what the user is asked to confirm", () => {
  it("shows an invoice's lines, GST and total the way the invoice will be booked", () => {
    const text = invoicePreview({
      member: "Asha Verma (PHG-1001)",
      date: "2026-10-06",
      dueDate: "2026-10-13",
      gstLabel: "18% CGST+SGST",
      lines: [
        { description: "Personal training", qty: 4, rate: 150000, discount: 0, taxRate: 18 },
        { description: "Shaker", qty: 1, rate: 30000, discount: 5000, taxRate: 0 },
      ],
      payAmount: 300000,
      payMethod: "UPI",
    });
    expect(text).toContain("Invoice for Asha Verma (PHG-1001)");
    expect(text).toContain("Date 6 Oct 2026 · due 13 Oct 2026");
    expect(text).toContain("GST 18% ₹1,080.00");
    expect(text).toContain("no GST");
    // 6000 + 300 - 50 = 6250 before GST, GST 1080, total 7330.
    expect(text).toContain("Total ₹7,330.00");
    expect(text).toContain("Received now: ₹3,000.00 by UPI; balance ₹4,330.00 due 13 Oct 2026");
  });
  it("says so when nothing is received, or all of it is", () => {
    const base = { member: "A", date: "2026-10-06", dueDate: "2026-10-06", gstLabel: "GST off", lines: [{ description: "x", qty: 1, rate: 100000, discount: 0, taxRate: 0 }] };
    expect(invoicePreview({ ...base, payAmount: 0 })).toContain("Nothing received now; ₹1,000.00 due 6 Oct 2026");
    expect(invoicePreview({ ...base, payAmount: 100000, payMethod: "Cash" })).toContain("(paid in full)");
  });
  it("shows a sale with its registration fee and GST", () => {
    const text = salePreview({ member: "A", plan: "Quarterly", months: 3, start: "2026-10-06", end: "2027-01-05", price: 400000, discount: 40000, regFee: 50000, taxRate: 18, gstLabel: "18% CGST+SGST", renewal: false, payAmount: 0, offer: "DIWALI" });
    expect(text).toContain("Sell Quarterly (3 months) for A");
    expect(text).toContain("includes offer DIWALI");
    // (4000 - 400 + 500) = 4100, GST 738, total 4838.
    expect(text).toContain("Invoice total ₹4,838.00");
    expect(salePreview({ member: "A", plan: "Monthly", months: 1, start: "2026-10-06", end: "2026-11-05", price: 100000, discount: 0, regFee: 0, taxRate: 0, gstLabel: "", renewal: true, payAmount: 0 })).toContain("Renew Monthly (1 month)");
  });
  it("shows a payment's balance before and after", () => {
    const text = paymentPreview({ invoice: "INV-1003", member: "Asha", amount: 200000, method: "UPI", date: "2026-10-06", balance: 500000, ref: "UTR1" });
    expect(text).toContain("Balance before ₹5,000.00, after ₹3,000.00");
    expect(paymentPreview({ invoice: "I", member: "A", amount: 100, method: "Cash", date: "2026-10-06", balance: 100 })).toContain("(fully paid)");
  });
  it("shows an expense, a cancellation and a reversal with what they will do", () => {
    expect(expensePreview({ date: "2026-10-06", category: "Electricity", group: "Utilities", description: "September bill", amount: 840000, method: "UPI", vendor: "MSEB", billNo: "B-12", branch: "City Centre" })).toContain("₹8,400.00 · Electricity (Utilities) · paid by UPI on 6 Oct 2026");
    const c = cancelPreview({ invoice: "INV-1", member: "A", total: 118000, paid: 118000, reason: "Wrong plan", hasMembership: true });
    expect(c).toContain("payments (₹1,180.00) will be reversed");
    expect(c).toContain("membership it created will be cancelled");
    expect(c).toContain("cannot be undone");
    expect(reversePreview({ code: "PAY-5001", invoice: "INV-1", member: "A", amount: 1000, method: "Cash", reason: "Bounced" })).toContain("balance goes back up");
  });
  it("words validation problems briefly", () => {
    expect(problemText([{ path: ["lines", 0, "qty"], message: "Too small" }, { path: [], message: "Bad" }])).toBe("lines.0.qty: Too small; Bad");
  });
});
