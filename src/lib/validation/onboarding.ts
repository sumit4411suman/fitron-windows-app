import * as z from "zod";
import "@/lib/zod-config";
import { GST_TYPES, START_MODES, STAFF_ROLES } from "@/lib/domain/onboarding";

const text = (max: number) => z.string().max(max, { error: "That is too long." });

/**
 * What the setup wizard sends to the server. Only the shape and size are checked here; the rules a person reads (GSTIN,
 * prices, phone numbers…) are in `validateStep`, which the form runs too, so both say the same thing.
 */
export const onboardingForm = z.object({
  tax: z.object({ gst: z.boolean(), gstin: text(20), rate: text(8), type: z.enum(GST_TYPES), prefix: text(16), start: text(14) }),
  branch: z.object({ short: text(80), hours: text(80), manager: text(160) }),
  rows: z.array(z.object({ name: text(160), months: text(6), price: text(16), regFee: text(16) })).max(12),
  staff: z.array(z.object({ name: text(160), role: z.enum(STAFF_ROLES), phone: text(24), email: text(200), password: text(200) })).max(12),
  wa: z.object({ welcome: z.boolean(), d7: z.boolean(), d3: z.boolean(), d1: z.boolean(), d0: z.boolean(), birthday: z.boolean() }),
  opening: z.object({ cash: text(16), bank: text(16) }),
  mode: z.enum(START_MODES),
});

export const onboardingStep = z.enum(["tax", "branch", "plans", "staff", "whatsapp", "opening", "start", "review"]);
