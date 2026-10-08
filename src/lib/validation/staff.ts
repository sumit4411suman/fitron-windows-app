import * as z from "zod";
import "@/lib/zod-config";
import { indianPhone, optionalText } from "./common";

export const staffInput = z.object({
  name: z.string().trim().min(2, { error: "Enter a name." }).max(120),
  email: z.email({ error: "Enter a valid email." }).transform((s) => s.toLowerCase()),
  phone: indianPhone,
  roleId: z.string().min(1, { error: "Pick a role." }),
  branchIds: z.array(z.string()).min(1, { error: "Pick at least one branch." }),
  shift: optionalText,
  ptRate: z.coerce.number().min(0).max(100).default(0),
  password: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(8, { error: "Password needs at least 8 characters." }).max(200).optional(),
  ),
});

export type StaffInput = z.infer<typeof staffInput>;
