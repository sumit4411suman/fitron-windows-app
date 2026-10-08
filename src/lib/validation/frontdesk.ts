import * as z from "zod";
import "@/lib/zod-config";
import { indianPhone, optionalDate, optionalPhone, optionalText, rupees } from "./common";
import { METHODS } from "./billing";
import { SOURCES } from "./member";

export const LEAD_STAGES = ["New", "Contacted", "Trial booked", "Trial done", "Won", "Lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const leadInput = z.object({
  name: z.string().trim().min(2, { error: "Enter their name." }).max(120),
  phone: indianPhone,
  source: z.enum(SOURCES, { error: "Pick where they heard about you." }),
  interest: z.string().trim().min(1, { error: "What are they interested in?" }).max(120),
  followUpOn: optionalDate,
  trialOn: optionalDate,
  ownerId: z.string().min(1, { error: "Pick who follows up." }),
  notes: optionalText,
});
export type LeadInput = z.infer<typeof leadInput>;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Use a time like 18:30." });
const count = (label: string, min = 1, max = 1000) =>
  z.coerce.number({ error: `Enter ${label}.` }).int({ error: `Enter ${label} as a whole number.` }).min(min, { error: `Enter ${label}.` }).max(max);

export const classInput = z.object({
  name: z.string().trim().min(2, { error: "Name the class." }).max(80),
  trainerId: z.string().min(1, { error: "Pick a trainer." }),
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: time,
  durationMin: count("the length in minutes", 10, 240),
  capacity: count("the capacity", 1, 500),
  room: optionalText,
});
export type ClassInput = z.infer<typeof classInput>;

export const productInput = z.object({
  sku: z.string().trim().min(1, { error: "Enter a SKU or short code." }).max(40),
  name: z.string().trim().min(2, { error: "Name the product." }).max(120),
  category: z.string().trim().min(1, { error: "Pick a category." }).max(60),
  price: rupees.refine((n) => n > 0, { error: "Enter the selling price." }),
  cost: z.preprocess((v) => (v === "" || v == null ? "0" : v), rupees),
  trackStock: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  reorderLevel: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(0).optional()),
  gstApplicable: z.preprocess((v) => v === "on" || v === true, z.boolean()),
});
export type ProductInput = z.infer<typeof productInput>;

export const restockInput = z.object({
  qty: z.coerce.number({ error: "Enter a quantity." }).int().refine((n) => n !== 0, { error: "Enter a quantity." }),
  unitCost: z.preprocess((v) => (v === "" || v == null ? undefined : v), rupees.optional()),
  note: optionalText,
  vendor: optionalText,
  /** Restocking from the POS screen can book the purchase as an Inventory expense (prototype). */
  asExpense: z.preprocess((v) => v === "on" || v === true, z.boolean()).optional(),
});

export const posSaleInput = z.object({
  memberId: z.string().optional(),
  method: z.enum(METHODS, { error: "Pick how they paid." }),
  txnRef: optionalText,
  items: z.array(z.object({ productId: z.string().min(1), qty: z.number().int().min(1).max(999) })).min(1, { error: "Add something to the bill." }),
});
export type PosSaleInput = z.infer<typeof posSaleInput>;

/**
 * Workout days typed as text:
 *   Day A
 *   Goblet squat | 3 × 12
 *   Plank | 3 × 30 s
 * A line without "|" starts a new day.
 */
export function parseWorkoutDays(text: string) {
  const days: { name: string; exercises: { name: string; sets: string }[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-•*]\s*/, "");
    if (!line) continue;
    if (!line.includes("|")) {
      days.push({ name: line, exercises: [] });
      continue;
    }
    const [name, sets] = line.split("|").map((s) => s.trim());
    if (!days.length) days.push({ name: "Day 1", exercises: [] });
    days.at(-1)!.exercises.push({ name: name!, sets: sets ?? "" });
  }
  return days.filter((d) => d.exercises.length);
}
export const formatWorkoutDays = (days: { name: string; exercises: { name: string; sets: string }[] }[]) =>
  days.map((d) => [d.name, ...d.exercises.map((e) => `${e.name} | ${e.sets}`)].join("\n")).join("\n\n");

/** Meals typed as "Breakfast | Poha with peanuts" per line. */
export function parseMeals(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.includes("|"))
    .map((l) => {
      const [name, ...rest] = l.split("|");
      return { name: name!.trim(), food: rest.join("|").trim() };
    })
    .filter((m) => m.name && m.food);
}
export const formatMeals = (meals: { name: string; food: string }[]) => meals.map((m) => `${m.name} | ${m.food}`).join("\n");

export const workoutInput = z.object({
  name: z.string().trim().min(2, { error: "Name the plan." }).max(120),
  goal: z.string().trim().min(2, { error: "Enter the goal." }).max(60),
  level: z.enum(["Beginner", "Intermediate", "Advanced"]),
  weeks: count("the number of weeks", 1, 104),
  days: z.string().transform(parseWorkoutDays).pipe(z.array(z.any()).min(1, { error: "Add at least one day with exercises, like \"Goblet squat | 3 × 12\"." })),
});
export type WorkoutInput = z.infer<typeof workoutInput>;

export const dietInput = z.object({
  name: z.string().trim().min(2, { error: "Name the plan." }).max(120),
  kcal: count("the calories", 500, 8000),
  protein: count("the protein in grams", 0, 500),
  meals: z.string().transform(parseMeals).pipe(z.array(z.any()).min(1, { error: "Add meals, one per line, like \"Breakfast | Poha with peanuts\"." })),
});
export type DietInput = z.infer<typeof dietInput>;

const measure = (max: number) => z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().positive().max(max).optional());
export const progressInput = z
  .object({ date: z.iso.date({ error: "Pick a date." }), weightKg: measure(400), bodyFat: measure(80), waistCm: measure(300), notes: optionalText })
  .refine((p) => p.weightKg || p.bodyFat || p.waistCm || p.notes, { error: "Enter at least one measurement.", path: ["weightKg"] });
export type ProgressInput = z.infer<typeof progressInput>;

const liftWeight = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number({ error: "Enter the weight." }).positive({ error: "Enter the weight." }).max(500, { error: "Enter the weight." }));
export const recordInput = z.object({
  lift: z.string().trim().min(1, { error: "Enter the lift." }).max(60),
  weightKg: liftWeight,
  reps: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(1).max(100).default(1)),
  date: z.iso.date({ error: "Pick a date." }).refine((d) => d <= new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), { error: "The date can't be in the future." }),
});
export type RecordInput = z.infer<typeof recordInput>;

export const guestInput = z.object({ name: z.string().trim().min(2, { error: "Enter the guest's name." }).max(120), phone: optionalPhone });

export const accessInput = z.object({
  blockSuspended: z.preprocess((v) => v === "on", z.boolean()),
  blockExpired: z.preprocess((v) => v === "on", z.boolean()),
  graceDays: z.coerce.number().int().min(0).max(60),
  blockDues: z.preprocess((v) => v === "on", z.boolean()),
  duesLimit: z.preprocess((v) => (v === "" || v == null ? "0" : v), rupees),
  hoursFrom: z.preprocess((v) => v ?? "", z.union([z.literal(""), time])),
  hoursTo: z.preprocess((v) => v ?? "", z.union([z.literal(""), time])),
  antiPassback: z.preprocess((v) => v === "on", z.boolean()),
});
