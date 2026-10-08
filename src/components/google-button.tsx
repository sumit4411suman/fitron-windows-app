import { GoogleLink } from "./google-link";
import { googleReady } from "@/lib/integrations/google";

// "Continue with Google", drawn to Google's sign-in button guidelines (white, the four-colour G).
// A plain link: it leaves the site for Google's account picker. Hidden until the keys are set.

export function GoogleButton({ href, label = "Continue with Google", divider = "or" }: { href: string; label?: string; divider?: string }) {
  if (!googleReady()) return null;
  return <GoogleLink href={href} label={label} divider={divider} />;
}

/** What to tell someone who comes back from Google without signing in (?google=…). */
export function googleMessage(code: unknown, email?: unknown): string | null {
  switch (code) {
    case "off":
      return "Google sign-in isn't switched on yet. Use your email and password.";
    case "cancelled":
      return "Google sign-in was cancelled. Try again, or use your email and password.";
    case "expired":
      return "That Google sign-in took too long. Try again.";
    case "failed":
      return "Google couldn't confirm your account. Try again in a minute.";
    case "nouser":
      return `There's no FITRON account for ${typeof email === "string" && email ? email : "that Google account"}. Ask your gym's owner to add you under Staff & roles, or start a free trial.`;
    default:
      return null;
  }
}
