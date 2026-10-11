import * as z from "zod";
import "@/lib/zod-config";
import { indianPhone, optionalDate, optionalPhone, optionalText } from "./common";

export const GENDERS = ["Male", "Female", "Other"] as const;
export const SOURCES = ["Walk-in", "Friend", "Instagram", "Facebook", "Google", "Website", "Flyer", "Other"] as const;

export const memberInput = z.object({
  name: z.string().trim().min(2, { error: "Enter the member's name." }).max(120),
  gender: z.enum(GENDERS, { error: "Pick a gender." }),
  dob: optionalDate,
  phone: indianPhone,
  whatsapp: optionalPhone,
  email: z.preprocess((v) => (v === "" ? undefined : v), z.email({ error: "Enter a valid email." }).optional()),
  occupation: optionalText,
  house: optionalText,
  area: optionalText,
  city: optionalText,
  state: optionalText,
  pin: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{6}$/, { error: "PIN code is 6 digits." }).optional()),
  emergencyName: optionalText,
  emergencyRelation: optionalText,
  emergencyPhone: optionalPhone,
  source: z.enum(SOURCES, { error: "Pick where they heard about you." }),
  notes: optionalText,
  staffNotes: optionalText,
  tags: z
    .string()
    .optional()
    .transform((s) => (s ?? "").split(",").map((t) => t.trim()).filter(Boolean)),
  trainerId: optionalText,
  /** The privacy-notice tick box. Ticked once, the date is kept on the member; it is never unticked from the form. */
  consent: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).optional(),
});

/** What the tick box says, on the member form and at import. */
export const CONSENT_LABEL = "The member agrees to Fitron's privacy notice (data stored to run their membership; WhatsApp reminders)";

export type MemberInput = z.infer<typeof memberInput>;
