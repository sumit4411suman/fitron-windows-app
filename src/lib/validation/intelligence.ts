import * as z from "zod";
import "@/lib/zod-config";
import { METHODS } from "./billing";
import { optionalDate, optionalText, rupees } from "./common";

// Forms of the Business Intelligence suite (docs/BUSINESS-INTELLIGENCE.md).

const number = (lo: number, hi: number, label: string) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[₹,\s]/g, "")) : v), z.number({ error: `Enter ${label}.` }).min(lo, { error: `${label} should be at least ${lo}.` }).max(hi, { error: `${label} should be at most ${hi}.` }));

export const attemptInput = z.object({
  kind: z.enum(["CALL", "VISIT", "NOTE"]),
  outcome: z.enum(["NO_ANSWER", "PROMISED", "REFUSED", "NOTED"]),
  note: optionalText,
  promisedOn: optionalDate,
  promisedAmount: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), rupees.optional()),
});

export const casePaymentInput = z.object({
  amount: rupees.refine((n) => n > 0, { error: "Enter the amount received." }),
  method: z.enum(METHODS, { error: "Pick how they paid." }),
  date: z.iso.date({ error: "Use a valid date." }),
  txnRef: optionalText,
  notes: optionalText,
});

export const closeCaseInput = z.object({ reason: z.string().trim().min(3, { error: "Say why it is closed." }).max(200) });

export const recoveryRulesInput = z.object({
  graceDays: number(0, 90, "grace days"),
  minBalance: rupees,
  renewalWindowDays: number(7, 365, "the renewal window"),
  followUpEveryDays: number(1, 30, "days between follow-ups"),
  callAfterAttempts: number(1, 10, "attempts before a call"),
  reviewAfterAttempts: number(2, 20, "attempts before a review"),
});

export const scenarioMeta = z.object({ name: z.string().trim().min(1, { error: "Name the scenario." }).max(120), note: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(2000).optional()) });

export const decisionInput = z.object({
  title: z.string().trim().min(2, { error: "Give the decision a title." }).max(160),
  category: z.enum(["PRICING", "PROMOTION", "HIRING", "EQUIPMENT", "HOURS", "OTHER"], { error: "Pick a category." }),
  objective: z.string().trim().min(5, { error: "Say what it should achieve." }).max(2000),
  constraints: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(2000).optional()),
  reviewDays: number(14, 365, "the review period in days"),
});

export const verdictInput = z.object({
  verdict: z.enum(["APPROVED", "REJECTED", "DEFERRED"]),
  optionId: optionalText,
  rationale: z.string().trim().min(5, { error: "Write the reasoning." }).max(4000),
  deferredUntil: optionalDate,
});

export const implementedInput = z.object({ implementedOn: z.iso.date({ error: "Use a valid date." }) });
export const reviewInput = z.object({ lessons: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(4000).optional()) });

export const recommendationDecision = z.object({
  status: z.enum(["ACCEPTED", "DISMISSED", "DEFERRED", "COMPLETED"]),
  note: optionalText,
  deferredUntil: optionalDate,
});
