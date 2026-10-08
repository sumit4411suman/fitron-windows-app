import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/services/accounts";
import { redeemTrainerLink } from "@/lib/services/trainer";
import { createTrainerSession } from "@/lib/services/trainer-session";

// The link from the sign-in email. Opening it (GET) only shows a "Sign in" button: mail scanners
// that open every link would otherwise use up the one-time token before the member taps it.
// Pressing the button (POST, from this site only) uses the token and opens the app.

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
const to = (path: string) => NextResponse.redirect(new URL(path, appUrl()), 303);

export function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!TOKEN.test(token)) return to("/trainer?link=expired");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Sign in · FITRON AI Trainer</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0b08;color:#f6efe2;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{width:min(360px,calc(100% - 32px));text-align:center}
  img{width:72px;height:72px}
  h1{font:600 26px/1.2 Georgia,serif;margin:16px 0 6px}
  p{color:#b9ad97;margin:0 0 24px}
  button{width:100%;min-height:52px;border:0;border-radius:14px;background:linear-gradient(135deg,#f0d27a,#c9a24a 55%,#9c7428);color:#1a1307;font:700 17px system-ui,sans-serif;cursor:pointer}
</style></head>
<body><main>
  <img src="/fitron-mark.png" alt="FITRON">
  <h1>Sign in to your AI Trainer</h1>
  <p>Tap below to finish signing in on this device.</p>
  <form method="post" action="/api/trainer/auth/verify">
    <input type="hidden" name="token" value="${token}">
    <button type="submit">Sign in</button>
  </form>
</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export async function POST(req: NextRequest) {
  // Only our own page may use a token, so another site can't sign a visitor into someone else's account.
  const sameSite = req.headers.get("origin") === new URL(appUrl()).origin || req.headers.get("sec-fetch-site") === "same-origin";
  if (!sameSite) return to("/trainer?link=expired");
  const form = await req.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const member = TOKEN.test(token) ? await redeemTrainerLink(token) : null;
  if (!member) return to("/trainer?link=expired");
  await createTrainerSession(member.id);
  return to("/trainer");
}
