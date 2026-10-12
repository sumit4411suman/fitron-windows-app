import * as z from "zod";
import "@/lib/zod-config";
import { newPassword } from "@/lib/validation/site";
import { sendVerification } from "@/lib/services/accounts";
import { emailReady } from "@/lib/integrations/email";
import { registerGym } from "@/lib/sync/server";
import { fail, json, readJson, withPassword } from "../_lib/http";

// Putting a gym that was set up on a computer onto fitron.in: a new account with the computer's ids, owned by the person
// on the computer. The records follow through the ordinary upload.
const id = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const input = z.object({
  email: z.email().max(200),
  password: newPassword,
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(20).default(""),
  gymName: z.string().trim().min(1).max(120),
  orgId: id,
  ownerId: id,
  deviceName: z.string().trim().max(80).default("FITRON for Windows"),
  installationId: z.string().max(64).optional(),
  sequences: z.array(z.object({ name: z.string().max(40), next: z.number().int().positive() })).max(50).default([]),
});

export async function POST(req: Request) {
  return withPassword(req, async () => {
    const parsed = input.safeParse(await readJson(req, 20_000));
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the details and try again.", 400);
    return json(await registerGym(parsed.data, sendVerification, emailReady()));
  });
}
