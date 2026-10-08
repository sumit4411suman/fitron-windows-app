import "server-only";
import { cookies } from "next/headers";
import { sign, unsign } from "@/lib/integrations/google";

// "The password (or Google) was right, a code is still needed": a signed cookie that lasts five minutes and holds who it is,
// where they were going and how they got this far. It is not a session: it opens nothing, and only a correct code from
// src/lib/services/two-step.ts (checked in src/app/login/actions.ts) turns it into one.

export const TWO_STEP_COOKIE = "fitron_2fa";
const TTL_MS = 5 * 60_000;

export type SignInVia = "email" | "google" | "email-link" | "email-code";
export type Challenge = { uid: string; next: string; via: SignInVia };
const VIAS: readonly string[] = ["email", "google", "email-link", "email-code"];

/** The cookie to set, for code that answers with a Response of its own (the Google callback). */
export const challengeCookie = (c: Challenge) => ({
  name: TWO_STEP_COOKIE,
  value: sign(c, TTL_MS),
  options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: TTL_MS / 1000 },
});

export async function startChallenge(c: Challenge) {
  const { name, value, options } = challengeCookie(c);
  (await cookies()).set(name, value, options);
}

export async function readChallenge(): Promise<Challenge | null> {
  const v = unsign<Challenge>((await cookies()).get(TWO_STEP_COOKIE)?.value);
  return v && typeof v.uid === "string" && typeof v.next === "string" && VIAS.includes(v.via) ? { uid: v.uid, next: v.next, via: v.via } : null;
}

export async function clearChallenge() {
  (await cookies()).delete(TWO_STEP_COOKIE);
}
