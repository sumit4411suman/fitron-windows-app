import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { challengeCookie } from "@/lib/auth/two-step-challenge";
import { safeNext } from "@/lib/auth/next";
import { GOOGLE_FLOWS, GOOGLE_FLOW_COOKIE, GOOGLE_SIGNUP_COOKIE, exchangeCode, googleBackUrl, sign, unsign, type GoogleFlow, type GoogleProfile } from "@/lib/integrations/google";
import { gymSignupHref } from "@/lib/domain/site-links";
import { appUrl, recordSignIn } from "@/lib/services/accounts";
import { hasTrainerAccount, signInTrainerWithGoogle } from "@/lib/services/trainer-google";
import { log } from "@/lib/log";

// Google sends the visitor back here. The state must match the one we set in /auth/google,
// and the code is redeemed with our PKCE verifier, so a forged or replayed callback goes nowhere.

type Flow = { state: string; verifier: string; flow: GoogleFlow; next: string; plan: string; cycle: string };

const to = (path: string) => NextResponse.redirect(new URL(path, appUrl()));
const cookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const f = unsign<Flow>(req.cookies.get(GOOGLE_FLOW_COOKIE)?.value);
  const done = (res: NextResponse) => {
    res.cookies.set(GOOGLE_FLOW_COOKIE, "", { path: "/auth/google", maxAge: 0 });
    return res;
  };
  if (!f) {
    log.warn("google.flow_cookie_missing", undefined, { host: req.nextUrl.host });
    const flow = (q.get("state") ?? "").split(".")[0];
    return done(to(googleBackUrl((GOOGLE_FLOWS as readonly string[]).includes(flow) ? (flow as GoogleFlow) : "staff", "expired")));
  }
  const back = (code: string) => googleBackUrl(f.flow, code, { plan: f.plan, cycle: f.cycle });
  // Cancelled on Google's screen, or a state that isn't ours.
  if (q.get("error") || !q.get("code") || q.get("state") !== f.state) {
    log.warn("google.signin_cancelled", undefined, { error: q.get("error"), stateMatches: q.get("state") === f.state });
    return done(to(back("cancelled")));
  }

  let me: GoogleProfile;
  try {
    me = await exchangeCode(q.get("code")!, f.verifier, `${appUrl()}/auth/google/callback`);
  } catch (e) {
    log.error("google.signin_failed", e);
    return done(to(back("failed")));
  }

  if (f.flow === "trainer") {
    await signInTrainerWithGoogle(me);
    return done(to(safeNext(f.next, "/trainer")));
  }

  if (f.flow === "signup") {
    // An existing staff account just signs in; a new email goes on to the gym sign-up form.
    const user = await db.user.findFirst({ where: { email: me.email, active: true, deletedAt: null } });
    if (user) return done(await staffIn(user, "/dashboard"));
    const res = to(gymSignupHref({ plan: f.plan, cycle: f.cycle, google: "1" }));
    res.cookies.set(GOOGLE_SIGNUP_COOKIE, sign({ email: me.email, name: me.name }, 30 * 60_000), { ...cookie, maxAge: 1800 });
    return done(res);
  }

  const user = await db.user.findFirst({ where: { email: me.email, active: true, deletedAt: null } });
  if (!user) {
    // Not on any gym's team, but Google has confirmed the email and it already has an AI Trainer
    // account: open the member app instead of a dead end.
    if (await hasTrainerAccount(me.email)) {
      await signInTrainerWithGoogle(me);
      return done(to("/trainer"));
    }
    return done(to(`/login?google=nouser&email=${encodeURIComponent(me.email)}`));
  }
  return done(await staffIn(user, safeNext(f.next)));
}

/**
 * Google has verified the email, so an unconfirmed account counts as confirmed now. Its password
 * was never proven to belong to this person (anyone can sign up with someone else's address and
 * wait), so it is replaced and any other sessions end; they can set their own with "Forgot password?".
 */
async function staffIn(user: { id: string; emailVerifiedAt: Date | null; totpEnabledAt: Date | null }, next: string) {
  const userId = user.id;
  if (!user.emailVerifiedAt) {
    await db.session.deleteMany({ where: { userId } });
    await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), passwordHash: await hashPassword(randomBytes(24).toString("base64url")) } });
  }
  // Two-step sign-in applies to Google too: Google has proved the email, but the code proves the person holding the phone.
  if (user.totpEnabledAt) {
    const res = to("/login?step=2");
    const c = challengeCookie({ uid: userId, next, via: "google" });
    res.cookies.set(c.name, c.value, c.options);
    return res;
  }
  await createSession(userId);
  await recordSignIn(userId, "google");
  return to(next);
}
