import "server-only";
import type * as z from "zod";
import "@/lib/zod-config";
import { failed, fieldErrors, type FormState } from "@/lib/validation/common";
import { UserError } from "@/lib/services/errors";

/**
 * Parses a form with `schema`, runs `fn`, and turns validation and UserError failures into
 * FormState that refills the form. Redirects thrown by `fn` pass through.
 */
export async function formAction<S extends z.ZodType>(fd: FormData, schema: S, fn: (data: z.infer<S>) => Promise<unknown>, ok: string): Promise<FormState> {
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  try {
    await fn(parsed.data);
  } catch (e) {
    if (e instanceof UserError) return failed(fd, { message: e.message, errors: e.field ? { [e.field]: [e.message] } : undefined });
    throw e;
  }
  return { ok: true, message: ok, nonce: Math.random().toString(36).slice(2) };
}

/** For one-click actions (buttons): runs `fn` and reports a UserError as the message. */
export async function simpleAction(fn: () => Promise<unknown>, ok: string): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof UserError) return { message: e.message, nonce: Math.random().toString(36).slice(2) };
    throw e;
  }
  return { ok: true, message: ok, nonce: Math.random().toString(36).slice(2) };
}
