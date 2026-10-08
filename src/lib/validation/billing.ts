import * as z from "zod";
import "@/lib/zod-config";
import { optionalText, rupees } from "./common";

export const METHODS = ["UPI", "Cash", "Card", "Bank Transfer", "Other"] as const;
export const LINE_CATEGORIES = ["Personal Training", "Product", "Registration", "Additional Charge", "Other"] as const;

const zeroIfBlank = (v: unknown) => (v === "" || v == null ? "0" : v);

const paymentFields = {
  payAmount: z.preprocess(zeroIfBlank, rupees),
  payMethod: z.enum(METHODS).optional(),
  payRef: optionalText,
};

export const sellInput = z
  .object({
    planId: z.string().min(1, { error: "Pick a plan." }),
    startDate: z.iso.date({ error: "Pick a start date." }),
    discount: z.preprocess(zeroIfBlank, rupees),
    includeRegFee: z.preprocess((v) => v === "on" || v === true, z.boolean()),
    offerCode: optionalText,
    pricingCategory: optionalText,
    notes: optionalText,
    ...paymentFields,
  })
  .refine((v) => v.payAmount === 0 || v.payMethod, { error: "Pick how they paid.", path: ["payMethod"] });

export type SellInput = z.infer<typeof sellInput>;

export const paymentInput = z.object({
  amount: rupees.refine((n) => n > 0, { error: "Enter an amount." }),
  method: z.enum(METHODS, { error: "Pick how they paid." }),
  date: z.iso.date({ error: "Pick a date." }),
  txnRef: optionalText,
  notes: optionalText,
});

export type PaymentInput = z.infer<typeof paymentInput>;

export const lineInput = z.object({
  description: z.string().trim().min(1, { error: "Describe the charge." }).max(200),
  category: z.enum(LINE_CATEGORIES),
  qty: z.coerce.number().int().min(1).max(999),
  rate: rupees,
  discount: z.preprocess(zeroIfBlank, rupees),
  taxable: z.boolean(),
});

export const invoiceInput = z.object({
  memberId: z.string().min(1, { error: "Pick a member." }),
  date: z.iso.date(),
  dueDate: z.iso.date(),
  lines: z.array(lineInput).min(1, { error: "Add at least one line." }),
  ...paymentFields,
});

export type InvoiceInput = z.infer<typeof invoiceInput>;

export const reasonInput = z.object({
  reason: z.string().trim().min(3, { error: "Give a reason." }).max(300),
});
