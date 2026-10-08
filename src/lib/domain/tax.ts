import { formatInr } from "./billing";

export type GstPreviewInput = { enabled: boolean; rate: number; type: "CGST+SGST" | "IGST" };

/** Paise as rupees without a trailing ".00", as the settings and sidebar show figures. */
const rupees = (paise: number) => formatInr(paise).replace(/\.00$/, "");

/** A percentage without trailing zeros: 9, 2.5, 0.75. */
const pct = (n: number) => String(Math.round(n * 1000) / 1000);

const SAMPLE_PAISE = 150000;

/**
 * The one-line example under Billing & GST: what a ₹1,500 plan costs with the current tax, and the
 * next invoice number. Computed from settings at render time; invoices snapshot their own rate.
 */
export function gstPreview(t: GstPreviewInput, prefix: string, nextNumber: number): string {
  const next = `Next invoice: ${prefix}${nextNumber}.`;
  if (!t.enabled) return `GST is off. Invoices show no tax. ${next}`;
  const rate = Number.isFinite(t.rate) ? t.rate : 0;
  const taxPaise = Math.round((SAMPLE_PAISE * rate) / 100);
  const parts = t.type === "IGST" ? `IGST ${pct(rate)}%` : `CGST ${pct(rate / 2)}% + SGST ${pct(rate / 2)}%`;
  return `A ${rupees(SAMPLE_PAISE)} plan is billed as ${rupees(SAMPLE_PAISE)} + ${parts} = ${rupees(SAMPLE_PAISE + taxPaise)}. ${next}`;
}

/** The monogram on an invoice without a logo: the first letters of the gym's first two words. */
export function gymInitials(name: string): string {
  const s = String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!)
    .join("")
    .toUpperCase();
  return s || "?";
}
