// SQLite takes at most 999 values in one statement (Prisma's limit for it), PostgreSQL 32,767. Services ask for "the
// summaries of these members" with every member's id; on a gym with a few thousand members that one query fails on
// FITRON for Windows ("The query parameter limit supported by your database is exceeded"). The Local client
// (local-client.ts) passes each read or bulk write through here: a top-level `where` field with a list of more than
// IN_SLICE values runs as one query per slice, and the results are put back together as the single query would have
// returned them (ordered, distinct, skipped and taken; counts and groups added up). A query whose result could not be
// put back together exactly (a cursor, an order on a relation, a group not by that field) is left as it is.

export const IN_SLICE = 500;
export const NOT_SLICED = Symbol("not sliced");

type Row = Record<string, unknown>;
type Args = Record<string, unknown>;
type Dir = "asc" | "desc";

const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** The top-level `where` field whose only condition is `in` with more than IN_SLICE values. */
export function longIn(args: unknown): { field: string; list: unknown[] } | null {
  if (!isPlain(args) || !isPlain(args.where)) return null;
  for (const [field, cond] of Object.entries(args.where)) {
    if (isPlain(cond) && Object.keys(cond).length === 1 && Array.isArray(cond.in) && cond.in.length > IN_SLICE) return { field, list: [...new Set(cond.in)] };
  }
  return null;
}

/** `orderBy` as [field, direction] pairs, or null when it orders on anything but the row's own fields. */
export function orderOf(orderBy: unknown): [string, Dir][] | null {
  if (orderBy === undefined) return [];
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out: [string, Dir][] = [];
  for (const o of list) {
    if (!isPlain(o) || Object.keys(o).length !== 1) return null;
    const [field, v] = Object.entries(o)[0]!;
    const dir = typeof v === "string" ? v : isPlain(v) && typeof v.sort === "string" && v.nulls === undefined ? v.sort : null;
    if (dir !== "asc" && dir !== "desc") return null;
    out.push([field, dir]);
  }
  return out;
}

const key = (v: unknown): number | string | bigint | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" || typeof v === "string" || typeof v === "bigint") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return String(v); // Decimal and the like
};

/** As SQLite orders: NULL before any value ascending, after them descending. */
export function compareBy(order: [string, Dir][]) {
  return (a: Row, b: Row) => {
    for (const [f, dir] of order) {
      const x = key(a[f]);
      const y = key(b[f]);
      if (x === y) continue;
      const c = x === null ? -1 : y === null ? 1 : typeof x === "string" || typeof y === "string" ? (String(x) < String(y) ? -1 : 1) : x < y ? -1 : 1;
      return dir === "asc" ? c : -c;
    }
    return 0;
  };
}

const slices = <T>(list: T[]) => Array.from({ length: Math.ceil(list.length / IN_SLICE) }, (_, i) => list.slice(i * IN_SLICE, (i + 1) * IN_SLICE));

/**
 * Runs `operation` slice by slice when its `where` has a long list, returning the combined result; NOT_SLICED when it
 * has none or the result could not be combined exactly (then the caller runs the query as it is).
 */
export async function inSlices(operation: string, args: unknown, run: (args: unknown) => Promise<unknown>): Promise<unknown> {
  const long = longIn(args);
  if (!long) return NOT_SLICED;
  const a = args as Args;
  const withSlice = (slice: unknown[], extra: Args = {}) => ({ ...a, ...extra, where: { ...(a.where as Args), [long.field]: { in: slice } } });

  if (operation === "deleteMany" || operation === "updateMany") {
    let count = 0;
    for (const s of slices(long.list)) count += ((await run(withSlice(s))) as { count: number }).count;
    return { count };
  }

  if (operation === "count") {
    if (a.skip !== undefined || a.take !== undefined || a.cursor !== undefined) return NOT_SLICED;
    let total: number | Record<string, number> | null = null;
    for (const s of slices(long.list)) {
      const r = (await run(withSlice(s))) as number | Record<string, number>;
      if (typeof r === "number") total = ((total as number | null) ?? 0) + r;
      else {
        const t: Record<string, number> = (total as Record<string, number> | null) ?? {};
        for (const [k, v] of Object.entries(r)) t[k] = (t[k] ?? 0) + v;
        total = t;
      }
    }
    return total;
  }

  if (operation === "groupBy") {
    const by = Array.isArray(a.by) ? a.by : [a.by];
    const order = orderOf(a.orderBy);
    if (!by.includes(long.field) || a.skip !== undefined || a.take !== undefined || !order || order.some(([f]) => !by.includes(f))) return NOT_SLICED;
    const rows: Row[] = [];
    for (const s of slices(long.list)) rows.push(...((await run(withSlice(s))) as Row[]));
    return order.length ? rows.sort(compareBy(order)) : rows;
  }

  if (operation === "findMany") {
    const order = orderOf(a.orderBy);
    const take = a.take as number | undefined;
    const skip = (a.skip as number | undefined) ?? 0;
    if (!order || a.cursor !== undefined || (take !== undefined && take < 0)) return NOT_SLICED;
    const distinct = a.distinct === undefined ? [] : ((Array.isArray(a.distinct) ? a.distinct : [a.distinct]) as string[]);
    // Fields the combination needs but the caller did not select are read too, and dropped again.
    const select = isPlain(a.select) ? { ...a.select } : undefined;
    const added = select ? [...order.map(([f]) => f), ...distinct].filter((f) => !select[f]) : [];
    for (const f of added) select![f] = true;
    const extra: Args = { skip: undefined, take: take === undefined ? undefined : skip + take, ...(select ? { select } : {}) };
    let rows: Row[] = [];
    for (const s of slices(long.list)) rows.push(...((await run(withSlice(s, extra))) as Row[]));
    if (order.length) rows.sort(compareBy(order));
    if (distinct.length) {
      const seen = new Set<string>();
      rows = rows.filter((r) => {
        const k = JSON.stringify(distinct.map((f) => key(r[f])?.toString() ?? null));
        return seen.has(k) ? false : (seen.add(k), true);
      });
    }
    rows = rows.slice(skip, take === undefined ? undefined : skip + take);
    if (added.length) rows = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !added.includes(k))));
    return rows;
  }
  return NOT_SLICED;
}
