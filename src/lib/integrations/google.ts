import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { GYM_SIGNIN_HREF, TRAINER_HREF, gymSignupHref } from "@/lib/domain/site-links";

// "Continue with Google": OAuth 2.0 authorization-code flow with PKCE (OpenID Connect).
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from Google Cloud › APIs & Services › Credentials
// (OAuth client, type "Web application", redirect URI https://<domain>/auth/google/callback).

const env = (k: string) => process.env[k]?.trim() || "";
export const googleReady = () => !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));

/** Where each flow starts: the console login, the gym sign-up, or the AI Trainer member app. */
export const GOOGLE_FLOWS = ["staff", "signup", "trainer"] as const;
export type GoogleFlow = (typeof GOOGLE_FLOWS)[number];

/**
 * Where a flow comes back to with ?google=<code> when Google didn't sign anyone in (off, cancelled,
 * expired, failed, no account). A gym sign-up goes back to the console's Create account tab and
 * keeps the plan that was picked.
 */
export function googleBackUrl(flow: GoogleFlow, code: string, picked: { plan?: string | null; cycle?: string | null } = {}): string {
  if (flow === "signup") return gymSignupHref({ ...picked, google: code });
  return `${flow === "trainer" ? TRAINER_HREF : GYM_SIGNIN_HREF}?${new URLSearchParams({ google: code })}`;
}
/** Carries state, PKCE verifier and flow from /auth/google to its callback (10 minutes). */
export const GOOGLE_FLOW_COOKIE = "fitron_google_flow";
/** Carries a Google-verified identity to the gym sign-up form (30 minutes). */
export const GOOGLE_SIGNUP_COOKIE = "fitron_google_signup";

const b64url = (b: Buffer) => b.toString("base64url");

export function newPkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(16)) };
}

export function authUrl(a: { redirectUri: string; state: string; challenge: string; hint?: string }) {
  const q = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: a.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: a.state,
    code_challenge: a.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    ...(a.hint ? { login_hint: a.hint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export type GoogleProfile = { sub: string; email: string; name: string; picture: string | null };

/**
 * Swaps the code for tokens at Google's token endpoint. The ID token comes straight from Google
 * over TLS in exchange for our client secret, so (per OpenID Connect Core 3.1.3.7) its claims are
 * checked rather than its signature: audience, issuer, expiry and a verified email.
 */
export async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<GoogleProfile> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, code_verifier: verifier, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!res.ok) {
    // Google's own reason (invalid_client, redirect_uri_mismatch, invalid_grant…) is what the logs need; it holds no secrets.
    const why = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
    throw new Error(`Google token exchange failed (${res.status} ${[why.error, why.error_description].filter(Boolean).join(": ")})`);
  }
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Google sent no ID token");
  return profileFromIdToken(id_token, env("GOOGLE_CLIENT_ID"));
}

export function profileFromIdToken(idToken: string, clientId: string, now = Date.now()): GoogleProfile {
  const part = idToken.split(".")[1];
  if (!part) throw new Error("Malformed ID token");
  const c = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  if (c.aud !== clientId) throw new Error("ID token is for another app");
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new Error("ID token not from Google");
  if (typeof c.exp !== "number" || c.exp * 1000 < now) throw new Error("ID token expired");
  if (c.email_verified !== true || typeof c.email !== "string") throw new Error("Google hasn't verified this email");
  return { sub: String(c.sub), email: c.email.toLowerCase(), name: typeof c.name === "string" ? c.name : c.email.split("@")[0]!, picture: typeof c.picture === "string" ? c.picture : null };
}

// A short-lived signed cookie carries a Google-verified identity from the callback to the
// gym sign-up form, so the form can trust the email without another round trip.
const secret = () => env("AUTH_SECRET") || env("CRON_SECRET") || (process.env.NODE_ENV === "production" ? "" : "dev-only-secret");

export function sign(data: object, ttlMs: number, now = Date.now()) {
  const key = secret();
  if (!key) throw new Error("AUTH_SECRET is not set");
  const body = b64url(Buffer.from(JSON.stringify({ ...data, exp: now + ttlMs })));
  return `${body}.${b64url(createHmac("sha256", key).update(body).digest())}`;
}

export function unsign<T>(token: string | undefined, now = Date.now()): T | null {
  const key = secret();
  if (!token || !key) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", key).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
  return v.exp > now ? v : null;
}
