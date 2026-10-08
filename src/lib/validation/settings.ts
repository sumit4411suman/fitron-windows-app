import * as z from "zod";
import "@/lib/zod-config";
import { indianPhone, optionalPhone } from "./common";
import { NOTICE_KEYS, type NoticeKey } from "@/lib/domain/privacy";
import { EXPIRY_CHIPS } from "@/lib/domain/reminders";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());

/** The gym's phone: gyms have landlines too, so 8–12 digits after spaces, dashes and +91 go. */
const gymPhone = z.preprocess(
  blank,
  z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s-]/g, "").replace(/^\+91(?=\d{10}$)/, ""))
    .pipe(z.string().regex(/^\d{8,12}$/, { error: "Enter the gym phone number." }))
    .optional(),
);

const website = z.preprocess(
  blank,
  z
    .string()
    .trim()
    .max(120)
    .transform((s) => s.replace(/^https?:\/\//i, "").replace(/\/+$/, ""))
    .pipe(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i, { error: "Website looks incomplete, e.g. yourgym.in." }))
    .optional(),
);

const instagram = z.preprocess(
  blank,
  z
    .string()
    .trim()
    .max(80)
    .transform((s) => s.replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "").replace(/\/+$/, "").replace(/^@/, ""))
    .pipe(z.string().max(60).regex(/^[A-Za-z0-9._]+$/, { error: "Instagram handle: letters, numbers, dots and underscores." }))
    .transform((s) => `@${s}`)
    .optional(),
);

/** Settings › Gym profile: the prototype's eight fields. */
export const gymInput = z.object({
  name: z.string().trim().min(2, { error: "Enter the gym name." }).max(120),
  tagline: opt(80),
  address: opt(300),
  state: opt(60),
  phone: gymPhone,
  email: z.preprocess(blank, z.email({ error: "Enter a valid email." }).max(120).optional()),
  website,
  instagram,
});
export type GymInput = z.infer<typeof gymInput>;

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const gstin = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim().toUpperCase() : v),
  z.string().regex(GSTIN, { error: "That isn't a valid GSTIN." }).optional(),
);

const prefix = z.string().trim().max(10).regex(/^[A-Za-z0-9/-]*$/, { error: "Letters, numbers, - and / only." });

/** Settings › Billing & GST. GST can only be charged with a GSTIN to print on the invoice. */
export const taxInput = z
  .object({
    enabled: z.preprocess((v) => v === "on", z.boolean()),
    rate: z.coerce.number().min(0).max(28),
    type: z.enum(["CGST+SGST", "IGST"]),
    gstin,
    sac: z.preprocess(blank, z.string().trim().regex(/^\d{4,8}$/, { error: "SAC code is 4–8 digits." }).optional()),
    invoicePrefix: z.preprocess((v) => v ?? "", prefix.transform((s) => s.toUpperCase())),
  })
  .superRefine((t, ctx) => {
    if (t.enabled && !t.gstin) ctx.addIssue({ code: "custom", path: ["gstin"], message: "Add your GSTIN to charge GST." });
  });
export type TaxInput = z.infer<typeof taxInput>;

export const numberingInput = z.object({ memberPrefix: prefix, invoicePrefix: prefix, paymentPrefix: prefix });

export const branchInput = z.object({
  name: z.string().trim().min(2, { error: "Enter a name." }).max(80),
  short: z.string().trim().min(1, { error: "Give the branch a short name, e.g. Main or City Centre." }).max(30),
  address: z.string().trim().min(3, { error: "Enter the address." }).max(300),
  phone: indianPhone,
  manager: opt(80),
  hours: z.string().trim().min(1, { error: "Enter opening hours." }).max(40),
  invoicePrefix: z.preprocess(blank, z.string().trim().max(10).regex(/^[A-Za-z0-9/-]*$/, { error: "Letters, numbers, - and / only." }).transform((s) => s.toUpperCase()).optional()),
  gstin,
});

const arr = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Settings › Reminders. Grace days are saved to Setting "access", the rest to "reminders". */
export const reminderInput = z.object({
  expiryDays: z
    .preprocess(arr, z.array(z.coerce.number().int().refine((n) => (EXPIRY_CHIPS as readonly number[]).includes(n), { error: "Pick from the listed days." })))
    .transform((ds) => [...new Set(ds)].sort((a, b) => b - a)),
  dedupDays: z.coerce.number().int().min(0).max(30),
  dueEveryDays: z.coerce.number().int().min(0).max(30),
  defaultMonths: z.coerce.number().int().min(1, { error: "At least 1 month." }).max(60),
  graceDays: z.coerce.number().int().min(0).max(60),
  birthdays: z.preprocess((v) => v === "on", z.boolean()),
});
export type ReminderInput = z.infer<typeof reminderInput>;

/** Settings › Subscription › Renewal reminders. */
export const renewalInput = z.object({
  remindDays: z.coerce.number().pipe(z.literal([14, 7, 3, 1], { error: "Pick 14, 7, 3 or 1 days." })),
  whatsapp: z.preprocess((v) => v === "on", z.boolean()),
  email: z.preprocess((v) => v === "on", z.boolean()),
});
export type RenewalInput = z.infer<typeof renewalInput>;

/** Settings › Subscription › Billing details, printed on FITRON's receipts. Blank fields clear the value. */
export const billingDetailsInput = z.object({
  legalName: opt(120),
  gstin,
  billingEmail: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() || undefined : v), z.email({ error: "Enter a valid email." }).max(120).optional()),
  address: opt(300),
});
export type BillingDetailsInput = z.infer<typeof billingDetailsInput>;

/** Settings › Integrations & AI › UPI autopay. The provider is read-only (Razorpay only). */
export const autopayInput = z.object({
  mode: z.enum(["demo", "live"]),
  retries: z.coerce.number().int({ error: "Retries must be a whole number." }).min(1, { error: "Retries: 1 to 10." }).max(10, { error: "Retries: 1 to 10." }),
  retryGap: z.coerce.number().int({ error: "Days between retries must be a whole number." }).min(1, { error: "Days between retries: 1 to 30." }).max(30, { error: "Days between retries: 1 to 30." }),
});
export type AutopayInput = z.infer<typeof autopayInput>;

/** Settings › Integrations & AI › Fitron AI: three checkboxes. */
export const aiInput = z.object({
  enabled: z.preprocess((v) => v === "on", z.boolean()),
  dailyBrief: z.preprocess((v) => v === "on", z.boolean()),
  autoWinback: z.preprocess((v) => v === "on", z.boolean()),
});
export type AiInput = z.infer<typeof aiInput>;

/** Settings › Reminders › Reports by email: one checkbox. */
export const reportsInput = z.object({ monthlyPl: z.preprocess((v) => v === "on", z.boolean()) });
export type ReportsInput = z.infer<typeof reportsInput>;

/** Settings › Privacy & DPDP › Grievance Officer. All optional so a gym can save as it goes; Go live checks name and email. */
export const privacyOfficerInput = z.object({
  officer: z.preprocess(blank, z.string().trim().max(120, { error: "Name: at most 120 characters." }).optional()),
  email: z.preprocess(blank, z.email({ error: "Enter a valid grievance email." }).trim().toLowerCase().max(120).optional()),
  phone: optionalPhone,
  retainMonths: z.preprocess(blank, z.coerce.number().int({ error: "Months must be a whole number." }).min(0, { error: "Months: 0 to 120." }).max(120, { error: "Months: 0 to 120." }).default(24)),
});
export type PrivacyOfficerInput = z.infer<typeof privacyOfficerInput>;

/** The nine notice sections (every textarea posts), plus the Reset to template button. */
export const privacyNoticeInput = z.object({
  ...Object.fromEntries(NOTICE_KEYS.map((k) => [`n_${k}`, z.string().trim().max(2000, { error: "Each section: at most 2,000 characters." })])),
  reset: z.string().optional(),
} as Record<`n_${NoticeKey}`, z.ZodString> & { reset: z.ZodOptional<z.ZodString> });
export type PrivacyNoticeInput = z.infer<typeof privacyNoticeInput>;

export const cookieNoticeInput = z.object({
  cookieNotice: z.string().trim().min(10, { error: "Cookie notice: write at least a sentence." }).max(1000, { error: "Cookie notice: at most 1,000 characters." }),
});
export type CookieNoticeInput = z.infer<typeof cookieNoticeInput>;
