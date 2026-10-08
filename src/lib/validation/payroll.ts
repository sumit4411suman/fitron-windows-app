import * as z from "zod";
import "@/lib/zod-config";
import { optionalDate, optionalText, rupees } from "./common";
import { METHODS } from "./billing";

const blank0 = (v: unknown) => (typeof v === "string" && v.trim() === "" ? "0" : v);
const money0 = z.preprocess(blank0, rupees);

export const salaryInput = z.object({
  salary: rupees,
  ptRate: z.coerce.number().min(0).max(100).default(0),
  joinedOn: optionalDate,
  payAccount: optionalText,
});
export type SalaryInput = z.infer<typeof salaryInput>;

export const advanceInput = z.object({
  amount: rupees.refine((n) => n > 0, { error: "Enter the advance amount." }),
  method: z.enum(METHODS),
  note: optionalText,
});
export type AdvanceInput = z.infer<typeof advanceInput>;

export const salaryPayInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, { error: "Pick a month." }),
  base: money0,
  commission: money0,
  bonus: money0,
  deductions: money0,
  advance: money0,
  days: z.coerce.number().int().min(0).max(31).default(0),
  method: z.enum(METHODS),
  reference: optionalText,
});
export type SalaryPayInput = z.infer<typeof salaryPayInput>;
