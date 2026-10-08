// What a build on Vercel does about the database. The Docker server applies new migrations each time it starts; Vercel has no
// such step, so the build does it (scripts/vercel-build.ts), and only when it is safe to.

export type BuildPlan = {
  /** Apply the pending database migrations before building. */
  migrate: boolean;
  /** One line for the build log. */
  notice: string;
};

/**
 * Only a Production build changes the database. A preview of a branch must never touch the live one: it may carry
 * migrations nobody has approved yet.
 *
 * With no database address at all the build carries on, loudly, and does not fail. fitron.in's pages that need no
 * database still deploy; failing every deploy until the database is set up would block unrelated changes. When an address
 * is there and the migration fails, the build does fail: the new code must not go live on a database in an unknown state.
 */
export function buildPlan(env: Record<string, string | undefined>): BuildPlan {
  const where = env.VERCEL_ENV;
  if (where !== "production") {
    return {
      migrate: false,
      notice: where ? `${where} build: database migrations are skipped (only a production build applies them).` : "Not a Vercel production build: database migrations are skipped.",
    };
  }
  const via = env.DIRECT_URL?.trim() ? "DIRECT_URL" : env.DATABASE_URL?.trim() ? "DATABASE_URL" : null;
  if (!via) {
    return {
      migrate: false,
      notice:
        "WARNING: neither DIRECT_URL nor DATABASE_URL is set for Production, so no database migrations were applied and sign-in and sign-up will fail until one is set (deploy/VERCEL.md, step 2). Building anyway.",
    };
  }
  return { migrate: true, notice: `Production build: applying database migrations through ${via}.` };
}
