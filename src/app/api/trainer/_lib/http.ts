import "server-only";
import type { TrainerMember } from "@/generated/prisma/client";
import { UserError } from "@/lib/services/errors";
import { currentTrainer } from "@/lib/services/trainer-session";
import { log } from "@/lib/log";

// Shared bits of the AI Trainer API routes: who is signed in, JSON bodies, and errors as JSON.

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

/** The request's JSON body, read only up to `max` bytes (the saved profile with a photo is the biggest, under 400 KB). */
export async function body<T = Record<string, unknown>>(req: Request, max = 512_000): Promise<T> {
  const text = await readCapped(req, max);
  if (text === null) throw new UserError("That's more than the app can send at once.");
  let b: unknown = null;
  try {
    b = JSON.parse(text);
  } catch {}
  return (b && typeof b === "object" ? b : {}) as T;
}

/** The body as text, or null when it's longer than `max` bytes. Stops reading as soon as it is. */
export async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf8");
}

/** Runs `fn` for the signed-in member; 401 without a session, 400 with the message for a UserError. */
export async function withTrainer(fn: (m: TrainerMember) => Promise<Response>) {
  const m = await currentTrainer();
  if (!m) return json({ error: "Sign in again." }, 401);
  try {
    return await fn(m);
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    log.error("trainer_api.failed", e);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}
