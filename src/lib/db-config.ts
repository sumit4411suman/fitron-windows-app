import type { PoolConfig } from "pg";

// How the app connects to Postgres. A Docker server just uses DATABASE_URL and nothing here changes. Two optional settings
// make it work on a host without a disk or a long-lived process, such as Vercel:
//   DATABASE_CA        the text (PEM) of the certificate authority that signed the database's certificate. Supabase has its
//                      own, so a bare sslmode=require is refused ("unable to verify the first certificate"), and a file path
//                      is no use where there is nowhere to put the file.
//   DATABASE_POOL_MAX  how many connections one running copy of the app may hold (default 10, or 3 on Vercel). Many
//                      short-lived copies share a pooler with a small limit, so a hosted setup wants fewer each.
//
// Whatever the limit, a request never waits forever for a connection and a query never runs forever: a burst of requests
// (one tab firing dozens of searches at once) then fails some of them quickly instead of piling up connections until the
// database refuses everyone.

const SSL_PARAMS = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]);

/**
 * The connection string without its ssl settings. The driver lets anything written in the string win over the options
 * passed beside it, so with DATABASE_CA the string must not say how to do SSL. Only the query part is touched: the user,
 * password and host are returned byte for byte.
 */
export function withoutSslParams(url: string): string {
  const q = url.indexOf("?");
  if (q < 0) return url;
  const kept = url
    .slice(q + 1)
    .split("&")
    .filter((p) => p && !SSL_PARAMS.has(p.split("=")[0]!.toLowerCase()));
  return kept.length ? `${url.slice(0, q)}?${kept.join("&")}` : url.slice(0, q);
}

/** How long a request waits for a free connection before giving up. */
export const CONNECT_WAIT_MS = 10_000;
/** The longest one statement may run on the server before Postgres stops it. */
export const STATEMENT_TIMEOUT_MS = 20_000;
/** An unused connection is closed after this long, so a quiet copy of the app gives its connections back. */
export const IDLE_MS = 10_000;

export function poolConfig(env: Record<string, string | undefined> = process.env): PoolConfig {
  const config: PoolConfig = {
    connectionString: env.DATABASE_URL,
    max: env.VERCEL ? 3 : 10,
    connectionTimeoutMillis: CONNECT_WAIT_MS,
    idleTimeoutMillis: IDLE_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  };
  const ca = env.DATABASE_CA?.trim();
  if (ca) {
    // A one-line environment variable can't hold line breaks, so "\n" written out is accepted too.
    config.ssl = { ca: ca.replace(/\\n/g, "\n") };
    if (config.connectionString) config.connectionString = withoutSslParams(config.connectionString);
  }
  const max = Number(env.DATABASE_POOL_MAX);
  if (Number.isInteger(max) && max > 0) config.max = max;
  return config;
}
