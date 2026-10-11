// Small in-memory fixed-window limiter. Good for one server; swap for Redis when
// running several instances.
const hits = new Map<string, { n: number; reset: number }>();
/** Past this many keys, windows that have run out are dropped, so keys from anonymous visitors don't pile up. */
const PRUNE_AT = 5_000;

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (hits.size > PRUNE_AT) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  h.n += 1;
  return h.n <= limit;
}

// Searches as you type are the cheapest thing to send many of, and each one is several database queries. One person
// gets a few in flight at a time and a steady rate; past that they are told to slow down and nothing touches the database.
const SEARCH_PER_WINDOW = 40;
const SEARCH_WINDOW_MS = 30_000;
const SEARCH_IN_FLIGHT = 3;
const inFlight = new Map<string, number>();

/**
 * Runs one search for this user, or returns `null` without running it when they are sending too many. Used by every
 * search box, so a burst from one tab can't take the database's connections from everyone else.
 */
export async function limitSearch<T>(userId: string, run: () => Promise<T>): Promise<T | null> {
  const n = inFlight.get(userId) ?? 0;
  if (n >= SEARCH_IN_FLIGHT || !rateLimit(`search:${userId}`, SEARCH_PER_WINDOW, SEARCH_WINDOW_MS)) return null;
  inFlight.set(userId, n + 1);
  try {
    return await run();
  } finally {
    const left = (inFlight.get(userId) ?? 1) - 1;
    if (left > 0) inFlight.set(userId, left);
    else inFlight.delete(userId);
  }
}

export const TOO_MANY_SEARCHES = "That's a lot of searches at once. Wait a few seconds and try again.";
