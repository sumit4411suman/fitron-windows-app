import * as z from "zod";
import "@/lib/zod-config";

const password = z.string().min(10, { error: "Use at least 10 characters." }).max(200);

/** First-run setup of the Local Edition: the gym, its first branch and its owner. */
export const localSetupInput = z
  .object({
    gymName: z.string().trim().min(2, { error: "Enter the gym's name." }).max(120),
    branchName: z.string().trim().min(1, { error: "Name the branch (for example Main)." }).max(80),
    address: z.string().trim().max(300).optional().default(""),
    ownerName: z.string().trim().min(2, { error: "Enter your name." }).max(120),
    email: z.email({ error: "Enter a valid email." }).transform((s) => s.trim().toLowerCase()),
    phone: z.string().trim().regex(/^[6-9]\d{9}$/, { error: "Enter a 10-digit mobile number." }),
    password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { error: "The two passwords are not the same.", path: ["confirm"] });

export type LocalSetupInput = z.infer<typeof localSetupInput>;

/** Owner password reset with the recovery key shown at setup (no email, no internet). */
export const localRecoverInput = z
  .object({
    email: z.email({ error: "Enter the owner's email." }).transform((s) => s.trim().toLowerCase()),
    recoveryKey: z.string().trim().min(10, { error: "Enter the recovery key." }).max(80),
    password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { error: "The two passwords are not the same.", path: ["confirm"] });

export type LocalRecoverInput = z.infer<typeof localRecoverInput>;
