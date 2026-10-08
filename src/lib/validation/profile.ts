import * as z from "zod";
import "@/lib/zod-config";
import { indianPhone } from "./common";
import { newPassword } from "./site";

export const profileInput = z.object({
  name: z.string().trim().min(2, { error: "Enter your name." }).max(120),
  phone: indianPhone,
});

export type ProfileInput = z.infer<typeof profileInput>;

export const passwordChangeInput = z
  .object({ current: z.string().min(1, { error: "Enter your current password." }), password: newPassword, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "The two passwords don't match." });

export type PasswordChangeInput = z.infer<typeof passwordChangeInput>;

// Two-step sign-in (src/lib/services/two-step.ts): a 6-digit code, or a recovery code where a code is asked for.
const code = z.string().trim().min(1, { error: "Enter the code." }).max(20, { error: "That code is too long." });
export const twoStepConfirmInput = z.object({ code });
export const twoStepOffInput = z.object({ password: z.string().min(1, { error: "Enter your password." }), code });
export const twoStepRecoveryInput = z.object({ password: z.string().min(1, { error: "Enter your password." }) });
