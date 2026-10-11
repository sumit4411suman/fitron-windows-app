import * as z from "zod";
import "@/lib/zod-config";
import { optionalText, rupees } from "./common";
import { todayIso } from "@/lib/services/time";

export const PLAN_KINDS = ["Membership", "Personal Training", "Add-on"] as const;

/** Prices a plan can have besides its standard one (the prototype's Female / Student / Male prices). */
export const PRICE_CATEGORIES = ["Female", "Student", "Male"] as const;
const optionalRupees = z.preprocess((v) => (v === "" || v == null ? undefined : v), rupees.optional());

export const planInput = z.object({
  name: z.string().trim().min(2, { error: "Enter a plan name." }).max(80),
  kind: z.enum(PLAN_KINDS),
  months: z.coerce.number().int().min(1, { error: "At least 1 month." }).max(60),
  price: rupees,
  regFee: z.preprocess((v) => (v === "" || v == null ? "0" : v), rupees),
  discount: z.preprocess((v) => (v === "" || v == null ? "0" : v), rupees),
  gstApplicable: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  description: optionalText,
  features: z
    .string()
    .optional()
    .transform((s) => (s ?? "").split("\n").map((t) => t.trim()).filter(Boolean)),
  femalePrice: optionalRupees,
  studentPrice: optionalRupees,
  malePrice: optionalRupees,
});

export type PlanInput = z.infer<typeof planInput>;

export const offerInput = z
  .object({
    code: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase().replace(/\s+/g, ""))
      .pipe(z.string().regex(/^[A-Z0-9-]{3,20}$/, { error: "Use 3–20 letters or numbers, like DIWALI25." })),
    description: z.string().trim().max(200).default(""),
    type: z.enum(["PERCENT", "FLAT"], { error: "Pick percent or rupees off." }),
    value: z.string().trim().min(1, { error: "Enter the discount." }),
    validTill: z.iso.date({ error: "Pick the last day it works." }),
    usageLimit: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(1, { error: "At least 1 use." }).max(100000).nullable()),
  })
  .transform((o, ctx) => {
    if (o.validTill < todayIso()) {
      ctx.addIssue({ code: "custom", path: ["validTill"], message: "The end date is in the past." });
      return z.NEVER;
    }
    const n = Number(o.value.replace(/[₹,%\s]/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter the discount." });
      return z.NEVER;
    }
    if (o.type === "PERCENT" && (n > 100 || !Number.isInteger(n))) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Use a whole percentage up to 100." });
      return z.NEVER;
    }
    return { ...o, value: o.type === "PERCENT" ? n : Math.round(n * 100) };
  });

export type OfferInput = z.infer<typeof offerInput>;
