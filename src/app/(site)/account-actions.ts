"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { formAction } from "@/lib/form-action";
import { rateLimit } from "@/lib/rate-limit";
import { createGymAccount, requestPasswordReset, resendVerification, resetPassword, verifyEmailWithCode, resetPasswordWithCode } from "@/lib/services/accounts";
import { GOOGLE_SIGNUP_COOKIE, unsign } from "@/lib/integrations/google";
import { UserError } from "@/lib/services/errors";
import { failed, type FormState } from "@/lib/validation/common";
import { emailOnlySchema, signInCodeSchema, gymSignupSchema, resetPasswordSchema, resetWithCodeSchema } from "@/lib/validation/site";

async function limited(fd: FormData, key: string, n: number) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return rateLimit(`${key}:${ip}`, n, 10 * 60_000) ? null : failed(fd, { message: "Too many tries in a few minutes. Wait a little and try again." });
}

export async function signUpGym(_: FormState, fd: FormData): Promise<FormState> {
  const blocked = await limited(fd, "signup", 5);
  if (blocked) return blocked;
  // Signed up with Google: the email is the one Google verified, and there's no password to pick
  // (they can set one later with "Forgot password?"). Only when the form says so: someone who
  // switched to another email after Google must not have this cookie's identity swapped in.
  const store = await cookies();
  const google = fd.get("google") === "1" ? unsign<{ email: string }>(store.get(GOOGLE_SIGNUP_COOKIE)?.value) : null;
  if (google) {
    fd.set("email", google.email);
    fd.set("password", randomBytes(24).toString("base64url"));
  } else if (fd.get("google") === "1") {
    // The 30 minutes Google's confirmation lasts have passed.
    return failed(fd, { message: "Your Google sign-in expired. Choose “Sign up with Google” again, or use your email." });
  }
  let next = "";
  const state = await formAction(
    fd,
    gymSignupSchema,
    async (d) => {
      const logo = fd.get("logo");
      const { user, verified } = await createGymAccount({ ...d, logo: logo instanceof File && logo.size > 0 ? logo : null }, !!google);
      if (google) store.delete(GOOGLE_SIGNUP_COOKIE);
      if (verified) {
        await createSession(user.id);
        next = "/onboarding";
      } else next = `/verify-email?sent=${encodeURIComponent(user.email)}`;
    },
    "",
  );
  if (next) redirect(next);
  // On the /login card the phone and the first error read as the card's own wording.
  if (state?.errors && fd.get("source") === "login") {
    const errors = { ...state.errors };
    if (errors.phone) errors.phone = ["Gym phone must be 10 digits."];
    const first = Object.values(errors).flat()[0];
    return { ...state, errors, message: first ?? state.message };
  }
  return state;
}

export async function resendLink(_: FormState, fd: FormData): Promise<FormState> {
  const blocked = await limited(fd, "resend", 3);
  if (blocked) return blocked;
  return formAction(fd, emailOnlySchema, (d) => resendVerification(d.email), "If that address is waiting to be confirmed, a new code and link are on their way. Check spam too.");
}

export async function forgotPassword(_: FormState, fd: FormData): Promise<FormState> {
  const blocked = await limited(fd, "forgot", 3);
  if (blocked) return blocked;
  return formAction(fd, emailOnlySchema, (d) => requestPasswordReset(d.email), "If there's an account with that email, a six-digit code and a reset link are on their way. The code works for 10 minutes, the link for 1 hour. Check spam too.");
}

export async function chooseNewPassword(_: FormState, fd: FormData): Promise<FormState> {
  const blocked = await limited(fd, "reset", 10);
  if (blocked) return blocked;
  let done = false;
  const state = await formAction(fd, resetPasswordSchema, async (d) => {
    await resetPassword(d.token, d.password);
    done = true;
  }, "");
  if (done) redirect("/login?reset=1");
  return state;
}

/** Password reset with the six-digit code from the email, typed here instead of opening the link. */
export async function chooseNewPasswordWithCode(_: FormState, fd: FormData): Promise<FormState> {
  const blocked = await limited(fd, "reset-code", 10);
  if (blocked) return blocked;
  // Per address too: a code has a million possibilities (and also stops after a few wrong tries).
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!rateLimit(`reset-code-for:${email}`, 10, 10 * 60_000)) return failed(fd, { message: "Too many wrong codes. Wait a few minutes and ask for a new one." });
  let done = false;
  const state = await formAction(fd, resetWithCodeSchema, async (d) => {
    await resetPasswordWithCode(d.email, d.code.replace(/\s/g, ""), d.password);
    done = true;
  }, "");
  if (done) redirect("/login?reset=1");
  return state;
}

/** Confirms a new account's email with the six-digit code from the sign-up email, typed on /verify-email. */
export async function confirmEmailWithCode(_: FormState, fd: FormData): Promise<FormState> {
  const blocked = await limited(fd, "verify-code", 20);
  if (blocked) return blocked;
  // Per address too: a code has a million possibilities (and also stops after a few wrong tries).
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (!rateLimit(`verify-code-for:${email}`, 10, 10 * 60_000)) return failed(fd, { message: "Too many wrong codes. Wait a few minutes and ask for a new one." });
  let done = false;
  const state = await formAction(fd, signInCodeSchema, async (d) => {
    if (!(await verifyEmailWithCode(d.email, d.code.replace(/\s/g, "")))) throw new UserError("That code is not right, or it has expired. Check it, or send a new one below.", "code");
    done = true;
  }, "");
  if (done) redirect("/login?verified=1");
  return state;
}
