"use server";

import { rateLimit } from "@/lib/rate-limit";
import { recoverOwner } from "@/lib/services/local-setup";
import { failed, fieldErrors, type FormState } from "@/lib/validation/common";
import { localRecoverInput } from "@/lib/validation/local-setup";

export type RecoverState = (FormState & { recoveryKey?: string }) | undefined;

export async function recoverWithKey(_: RecoverState, fd: FormData): Promise<RecoverState> {
  // A recovery key has about 100 bits; this only keeps the computer from being kept busy hashing.
  if (!rateLimit("local-recover", 5, 10 * 60_000)) return { message: "Too many tries. Wait ten minutes." };
  const parsed = localRecoverInput.safeParse(Object.fromEntries(fd));
  const keep = new FormData();
  keep.set("email", String(fd.get("email") ?? ""));
  if (!parsed.success) return failed(keep, { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  const r = await recoverOwner(parsed.data);
  if (!r) return failed(keep, { message: "That email and recovery key do not match an owner on this computer." });
  return { ok: true, recoveryKey: r.recoveryKey };
}
