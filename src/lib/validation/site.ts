import * as z from "zod";
import "@/lib/zod-config";
import { PLANS, findPlan } from "@/lib/domain/pricing";
import { indianPhone, optionalPhone, optionalText } from "./common";

const planKeys = PLANS.map((p) => p.key) as [string, ...string[]];

const contactBase = {
  name: z.string().trim().min(2, { error: "Enter your name." }).max(100),
  email: z.string().trim().toLowerCase().max(200).pipe(z.email({ error: "Enter a valid email address." })),
  phone: optionalPhone,
};

export const trialRequestSchema = z.object({
  ...contactBase,
  plan: z.enum(planKeys, { error: "Pick a plan." }),
  cycle: z.enum(["MONTHLY", "YEARLY"], { error: "Pick monthly or yearly." }),
  business: optionalText,
  city: optionalText,
}).superRefine((d, ctx) => {
  if (findPlan(d.plan)?.product !== "AI_TRAINER" && !d.business) ctx.addIssue({ code: "custom", path: ["business"], message: "Enter your gym's name." });
});

export const TOPICS = { general: "A question", sales: "Sales and pricing", demo: "Book a demo", partner: "Gym partnership", support: "Help with my account" } as const;

export const contactSchema = z.object({
  ...contactBase,
  topic: z.enum(Object.keys(TOPICS) as [keyof typeof TOPICS, ...(keyof typeof TOPICS)[]], { error: "Pick a topic." }),
  business: optionalText,
  message: z.string().trim().min(10, { error: "Tell us a little more (at least 10 characters)." }).max(4000),
});

const gymPlanKeys = PLANS.filter((p) => p.product === "GYM_ACCOUNTING").map((p) => p.key) as [string, ...string[]];

export const newPassword = z.string().min(10, { error: "Use at least 10 characters." }).max(200);

const pinField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().regex(/^\d{6}$/, { error: "PIN code must be 6 digits." }).optional(),
);
const shortText = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(120).optional());
const gymEmailField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().toLowerCase().max(200).pipe(z.email({ error: "Enter a valid gym email." })).optional(),
);

export const gymSignupSchema = z.object({
  plan: z.enum(gymPlanKeys, { error: "Pick a plan." }),
  cycle: z.enum(["MONTHLY", "YEARLY"], { error: "Pick monthly or yearly." }),
  name: contactBase.name,
  email: contactBase.email,
  phone: indianPhone,
  business: z.string().trim().min(2, { error: "Enter your gym's name." }).max(120),
  city: optionalText,
  password: newPassword,
  terms: z.literal("on", { error: "Tick this to continue." }),
  gymEmail: gymEmailField,
  address: optionalText,
  state: optionalText,
  pin: pinField,
  tagline: shortText,
  website: shortText,
  instagram: shortText,
  source: z.string().optional(),
}).superRefine((d, ctx) => {
  // The /login card asks for the whole gym profile; /signup keeps its short form.
  if (d.source !== "login") return;
  if (!d.gymEmail) ctx.addIssue({ code: "custom", path: ["gymEmail"], message: "Enter a valid gym email." });
  if (!d.address || !d.city) ctx.addIssue({ code: "custom", path: [!d.address ? "address" : "city"], message: "Enter the address and city." });
  if (!d.pin) ctx.addIssue({ code: "custom", path: ["pin"], message: "PIN code must be 6 digits." });
});

export const signupStep1Schema = z.object({
  name: contactBase.name,
  email: contactBase.email,
  password: newPassword,
  terms: z.literal("on", { error: "Please tick “I agree to Fitron’s Terms…” to continue." }),
});

export const emailOnlySchema = z.object({ email: contactBase.email });

const emailedCode = z.string().trim().regex(/^\d{3}\s?\d{3}$/, { error: "Enter the six-digit code from the email." });

/** Passwordless sign-in: the email and the six-digit code that was sent to it. */
export const signInCodeSchema = z.object({ email: contactBase.email, code: emailedCode });

/** Password reset with the emailed code instead of the link. */
export const resetWithCodeSchema = z
  .object({ email: contactBase.email, code: emailedCode, password: newPassword, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "The two passwords don't match." });

export const resetPasswordSchema = z
  .object({ token: z.string().min(10), password: newPassword, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "The two passwords don't match." });
