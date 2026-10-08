import * as z from "zod";
import "@/lib/zod-config";
import { ASSET_CATEGORIES } from "@/lib/domain/assets";
import { optionalText, rupees } from "./common";
import { METHODS } from "./billing";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalRupees = z.preprocess(blank, rupees.optional());

export const NOT_PAID = "none";

export const assetInput = z
  .object({
    name: z.string().trim().min(2, { error: "Name the asset." }).max(120),
    category: z.enum(ASSET_CATEGORIES, { error: "Pick a category." }),
    qty: z.coerce.number().int().min(1, { error: "Enter the quantity." }).max(10000),
    vendor: optionalText,
    purchaseDate: z.iso.date({ error: "Enter the purchase date." }),
    cost: rupees.refine((n) => n > 0, { error: "Enter the purchase cost." }),
    salvage: optionalRupees.transform((n) => n ?? 0),
    method: z.enum(["WDV", "SLM"]),
    rate: z.preprocess(blank, z.coerce.number().min(0).max(100).optional()),
    life: z.preprocess(blank, z.coerce.number().int().min(1).max(100).optional()),
    serial: optionalText,
    billNo: optionalText,
    /** How it was paid from the gym's books, or "none" when it wasn't (bought earlier, paid by the owner). */
    payMethod: z.enum([...METHODS, NOT_PAID], { error: "Pick how it was paid." }),
    notes: optionalText,
  })
  .superRefine((a, ctx) => {
    if (a.method === "WDV" && !(a.rate && a.rate > 0)) ctx.addIssue({ code: "custom", path: ["rate"], message: "Enter the depreciation rate." });
    if (a.method === "SLM" && !a.life) ctx.addIssue({ code: "custom", path: ["life"], message: "Enter the useful life in years." });
    if (a.salvage >= a.cost) ctx.addIssue({ code: "custom", path: ["salvage"], message: "Salvage value must be less than the cost." });
  });
export type AssetInput = z.infer<typeof assetInput>;

export const disposeInput = z
  .object({
    date: z.iso.date({ error: "Enter the date." }),
    type: z.enum(["SOLD", "SCRAPPED"]),
    amount: optionalRupees.transform((n) => n ?? 0),
    method: z.preprocess(blank, z.enum(METHODS).optional()),
    note: optionalText,
  })
  .superRefine((d, ctx) => {
    if (d.type === "SOLD" && d.amount > 0 && !d.method) ctx.addIssue({ code: "custom", path: ["method"], message: "Pick how the money came in." });
  });
export type DisposeInput = z.infer<typeof disposeInput>;

export const LINE_TYPES = ["STOCK", "ASSET", "EXPENSE"] as const;
export const NEW_PRODUCT = "new";

export const purchaseLine = z
  .object({
    type: z.enum(LINE_TYPES),
    description: z.string().trim().min(1, { error: "Describe the line." }).max(200),
    /** STOCK: product id or "new". ASSET: asset category. EXPENSE: expense category id. */
    ref: z.string().trim().min(1, { error: "Pick one." }),
    newSku: optionalText,
    newPrice: optionalRupees,
    qty: z.coerce.number().int().min(1, { error: "Enter the quantity." }).max(100000),
    rate: rupees.refine((n) => n > 0, { error: "Enter the rate." }),
    gstPct: z.coerce.number().min(0).max(28),
  })
  .superRefine((l, ctx) => {
    if (l.type === "STOCK" && l.ref === NEW_PRODUCT) {
      if (!l.newSku) ctx.addIssue({ code: "custom", path: ["newSku"], message: "Enter a SKU for the new product." });
      if (!l.newPrice) ctx.addIssue({ code: "custom", path: ["newPrice"], message: "Enter the selling price." });
    }
    if (l.type === "ASSET" && !(ASSET_CATEGORIES as readonly string[]).includes(l.ref)) ctx.addIssue({ code: "custom", path: ["ref"], message: "Pick an asset category." });
  });
export type PurchaseLineInput = z.infer<typeof purchaseLine>;

export const purchaseInput = z
  .object({
    date: z.iso.date({ error: "Enter the bill date." }),
    vendor: z.string().trim().min(2, { error: "Enter the supplier." }).max(120),
    billNo: optionalText,
    notes: optionalText,
    method: z.enum(METHODS, { error: "Pick how it was paid." }),
    paid: z.enum(["full", "part", "none"]),
    paidAmount: optionalRupees,
    lines: z.array(purchaseLine).min(1, { error: "Add at least one line." }).max(100),
  })
  .superRefine((p, ctx) => {
    if (p.paid === "part" && !(p.paidAmount && p.paidAmount > 0)) ctx.addIssue({ code: "custom", path: ["paidAmount"], message: "Enter how much was paid." });
  });
export type PurchaseInput = z.infer<typeof purchaseInput>;

export const vendorPayInput = z.object({
  date: z.iso.date({ error: "Enter the date." }),
  amount: rupees.refine((n) => n > 0, { error: "Enter the amount." }),
  method: z.enum(METHODS, { error: "Pick how it was paid." }),
  reference: optionalText,
});
export type VendorPayInput = z.infer<typeof vendorPayInput>;

/** GST-inclusive amount of a line, in paise. */
export const lineAmount = (l: { qty: number; rate: number; gstPct: number }) => Math.round(l.qty * l.rate * (1 + l.gstPct / 100));
