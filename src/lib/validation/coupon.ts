import * as z from "zod";
import "@/lib/zod-config";

const blankToNull = (v: unknown) => (v === "" || v == null ? null : v);

/** The FITRON team's new-coupon form (/fitron-admin/coupons). */
export const couponInput = z.object({
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase().replace(/\s+/g, ""))
    .pipe(z.string().regex(/^[A-Z0-9_-]{3,20}$/, { error: "Use 3–20 letters or numbers, like WELCOME99." })),
  description: z.string().trim().max(200).default(""),
  percentOff: z.coerce.number({ error: "Enter the discount." }).int({ error: "Use a whole percentage." }).min(1, { error: "At least 1%." }).max(100, { error: "At most 100%." }),
  /** Whole rupees the customer pays instead of a percentage off; blank for a percentage coupon. */
  payRupees: z.preprocess(blankToNull, z.coerce.number({ error: "Enter the amount in rupees." }).int({ error: "Use whole rupees." }).min(1, { error: "At least ₹1." }).max(1_000_000).nullable()),
  appliesTo: z.enum(["ALL", "GYM", "TRAINER"], { error: "Pick what it works on." }),
  validTill: z.preprocess(blankToNull, z.iso.date({ error: "Use a valid date." }).nullable()),
  usageLimit: z.preprocess(blankToNull, z.coerce.number().int().min(1, { error: "At least 1 use." }).max(1_000_000).nullable()),
});

export type CouponInput = z.infer<typeof couponInput>;
