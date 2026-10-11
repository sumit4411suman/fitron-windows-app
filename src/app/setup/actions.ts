"use server";

import { createSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/rate-limit";
import { recordSignIn } from "@/lib/services/accounts";
import { UserError } from "@/lib/services/errors";
import { createLocalGym, holdRecoveryKey, localSetupNeeded } from "@/lib/services/local-setup";
import { redirect } from "next/navigation";
import { failed, fieldErrors, type FormState } from "@/lib/validation/common";
import { localSetupInput } from "@/lib/validation/local-setup";

export type SetupState = FormState | undefined;

/** Echoes what was typed back into the form, without either password. */
const keep = (fd: FormData) => {
  const safe = new FormData();
  for (const k of ["gymName", "branchName", "address", "ownerName", "email", "phone"]) safe.set(k, String(fd.get(k) ?? ""));
  return safe;
};

/** First-run setup (Local Edition): creates the gym and its owner, signs the owner in, and shows the recovery key once. */
export async function setUpGym(_: SetupState, fd: FormData): Promise<SetupState> {
  if (!rateLimit("local-setup", 10, 60_000)) return { message: "Too many tries. Wait a minute." };
  if (!(await localSetupNeeded())) return { message: "FITRON is already set up on this computer. Sign in instead." };
  const parsed = localSetupInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return failed(keep(fd), { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  try {
    const r = await createLocalGym(parsed.data);
    holdRecoveryKey(r.userId, r.recoveryKey);
    await createSession(r.userId);
    await recordSignIn(r.userId, "email");
  } catch (e) {
    if (e instanceof UserError) return failed(keep(fd), { message: e.message, errors: e.field ? { [e.field]: [e.message] } : undefined });
    throw e;
  }
  redirect("/setup/key");
}
