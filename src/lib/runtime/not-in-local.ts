import { gymAccountingOnly } from "./edition";

/**
 * For the route handlers src/proxy.ts never runs for (its matcher leaves out webhooks, door devices, the AI Trainer's
 * APIs, the website assistant and Google sign-in): on FITRON for Windows they are not part of the app, so they answer
 * the way the proxy answers an API address in NOT_IN_LOCAL (src/lib/public-paths.ts). Null on the Cloud Edition: carry on.
 */
export function notInLocal(): Response | null {
  if (!gymAccountingOnly()) return null;
  return Response.json({ error: "Not part of FITRON Gym Accounting for Windows." }, { status: 404, headers: { "cache-control": "no-store" } });
}
