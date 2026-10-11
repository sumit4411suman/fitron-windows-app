import * as z from "zod";
import "@/lib/zod-config";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const optionalText = z.preprocess(blankToUndefined, z.string().trim().max(500).optional());

export const indianPhone = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, { error: "Enter a 10-digit mobile number." }));

export const optionalPhone = z.preprocess(blankToUndefined, indianPhone.optional());

export const optionalDate = z.preprocess(
  blankToUndefined,
  z.iso.date({ error: "Use a valid date." }).optional(),
);

/** Rupees typed in a form ("1,499.50") → integer paise. */
export const rupees = z
  .string()
  .trim()
  .transform((s) => s.replace(/[₹,\s]/g, ""))
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, { error: "Enter an amount in rupees." }))
  .transform((s) => Math.round(Number(s) * 100));

export type FieldErrors = Record<string, string[] | undefined>;
export type FormState =
  | {
      ok?: boolean;
      message?: string;
      errors?: FieldErrors;
      /** What was submitted, so the form can be refilled after an error (React resets forms after an action). */
      values?: Record<string, string | string[]>;
      /** Changes on every response so the form remounts with `values`. */
      nonce?: string;
    }
  | undefined;

/** Everything submitted in a form, with repeated keys as arrays. Passwords are never echoed back. */
export function formValues(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of new Set(fd.keys())) {
    if (k.startsWith("$") || /password/i.test(k)) continue;
    const all = fd.getAll(k).map(String);
    out[k] = all.length > 1 ? all : (all[0] ?? "");
  }
  return out;
}

export const failed = (fd: FormData, s: Omit<NonNullable<FormState>, "values" | "nonce">): FormState => ({
  ...s,
  values: formValues(fd),
  nonce: Math.random().toString(36).slice(2),
});

export const fieldErrors = (e: z.ZodError): FieldErrors => z.flattenError(e).fieldErrors as FieldErrors;
