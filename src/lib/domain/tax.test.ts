import { describe, expect, it } from "vitest";
import { gstPreview, gymInitials } from "./tax";

describe("gstPreview", () => {
  it("shows a ₹1,500 plan with CGST + SGST at 18%", () => {
    expect(gstPreview({ enabled: true, rate: 18, type: "CGST+SGST" }, "INV-", 1001)).toBe(
      "A ₹1,500 plan is billed as ₹1,500 + CGST 9% + SGST 9% = ₹1,770. Next invoice: INV-1001.",
    );
  });

  it("shows IGST as one line", () => {
    expect(gstPreview({ enabled: true, rate: 18, type: "IGST" }, "INV-", 1001)).toContain("+ IGST 18% = ₹1,770.");
  });

  it("prints half rates without trailing zeros", () => {
    expect(gstPreview({ enabled: true, rate: 5, type: "CGST+SGST" }, "INV-", 1001)).toContain("CGST 2.5% + SGST 2.5% = ₹1,575.");
    expect(gstPreview({ enabled: true, rate: 1.5, type: "CGST+SGST" }, "INV-", 1001)).toContain("CGST 0.75% + SGST 0.75%");
  });

  it("says GST is off and still shows the next number with the gym's prefix", () => {
    expect(gstPreview({ enabled: false, rate: 18, type: "CGST+SGST" }, "PHG-", 1042)).toBe("GST is off. Invoices show no tax. Next invoice: PHG-1042.");
  });
});

describe("gymInitials", () => {
  it.each([
    ["Power Haus Gym", "PH"],
    ["Ironworks", "I"],
    ["  ", "?"],
    ["", "?"],
  ])("%s → %s", (name, out) => {
    expect(gymInitials(name)).toBe(out);
  });
});
