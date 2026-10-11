// Which FITRON this process is. The Cloud Edition (fitron.in, a server with PostgreSQL) is the default, so nothing changes
// for existing deployments. The Local Windows Edition is started by the desktop shell (desktop/src-tauri) with
// FITRON_EDITION=local and keeps everything in a SQLite file on the customer's computer.
export type Edition = "cloud" | "local";

export function edition(env: Record<string, string | undefined> = process.env): Edition {
  return env.FITRON_EDITION?.trim().toLowerCase() === "local" ? "local" : "cloud";
}

export const isLocal = () => edition() === "local";
