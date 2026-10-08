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
