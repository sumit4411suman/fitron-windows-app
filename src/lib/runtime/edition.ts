// Which FITRON this process is. The Cloud Edition (fitron.in, a server with PostgreSQL) is the default, so nothing changes
// for existing deployments. The Local Windows Edition is started by the desktop shell (desktop/src-tauri) with
// FITRON_EDITION=local and keeps everything in a SQLite file on the customer's computer.
export type Edition = "cloud" | "local";

export function edition(env: Record<string, string | undefined> = process.env): Edition {
  return env.FITRON_EDITION?.trim().toLowerCase() === "local" ? "local" : "cloud";
}

export const isLocal = () => edition() === "local";

/**
 * The fitron.in sign-up and its emailed-link sign-ins, on a Local server. Never in a shipped installation: only the
 * end-to-end suite sets FITRON_LOCAL_ALLOW_SIGNUP, so its 300 specs can make a fresh gym per test the way they do on the
 * Cloud Edition. The Local first-run setup has its own spec (e2e/local/startup.spec.ts).
 */
export const localSignupAllowed = (env: Record<string, string | undefined> = process.env) => env.FITRON_LOCAL_ALLOW_SIGNUP === "1";

/**
 * FITRON Gym Accounting for Windows as shipped: the website, AI Trainer, FITRON's own billing, Gym Partnership, door
 * devices and the members' QR check-in page are closed (NOT_IN_LOCAL in src/lib/public-paths.ts, the same rule as
 * src/proxy.ts). False in the end-to-end suite's Local runs, which run the Cloud specs on SQLite too.
 */
export const gymAccountingOnly = () => isLocal() && !localSignupAllowed();
