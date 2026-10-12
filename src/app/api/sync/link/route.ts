import * as z from "zod";
import "@/lib/zod-config";
import { checkGym, linkDevice } from "@/lib/sync/server";
import { fail, json, readJson, withPassword } from "../_lib/http";

// Step one of linking a computer: the gym owner's fitron.in email, password and (when on) two-step code. "check" says
// which gym that is and what it holds; "link" makes the device and returns its token, once.
const input = z.object({
  mode: z.enum(["check", "link"]),
  email: z.email().max(200),
  password: z.string().min(1).max(200),
  code: z.string().max(20).optional(),
  name: z.string().trim().max(80).default("FITRON for Windows"),
  installationId: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  return withPassword(req, async () => {
    const parsed = input.safeParse(await readJson(req, 10_000));
    if (!parsed.success) return fail("Enter the fitron.in email and password.", 400);
    const d = parsed.data;
    const creds = { email: d.email, password: d.password, code: d.code };
    return json(d.mode === "check" ? await checkGym(creds) : await linkDevice(creds, { name: d.name, installationId: d.installationId }));
  });
}
