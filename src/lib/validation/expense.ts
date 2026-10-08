import * as z from "zod";
import "@/lib/zod-config";
import { optionalText, rupees } from "./common";
import { METHODS } from "./billing";

export const expenseInput = z.object({
  date: z.iso.date({ error: "Pick a date." }),
  categoryId: z.string().min(1, { error: "Pick a category." }),
  description: z.string().trim().min(2, { error: "Describe the expense." }).max(200),
  vendor: optionalText,
  amount: rupees.refine((n) => n > 0, { error: "Enter an amount." }),
  method: z.enum(METHODS, { error: "Pick how it was paid." }),
  billNo: optionalText,
  notes: optionalText,
});

export type ExpenseInput = z.infer<typeof expenseInput>;
