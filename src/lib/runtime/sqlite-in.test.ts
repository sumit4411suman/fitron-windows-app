import { describe, expect, it } from "vitest";
import { IN_SLICE, inSlices, longIn, NOT_SLICED, orderOf } from "./sqlite-in";

// A stand-in database: rows filtered, ordered, made distinct, skipped and taken as SQLite would, so each combined
// result can be compared with what one query over the whole list returns.
type Row = { id: string; memberId: string; n: number; at: Date | null };
const rows: Row[] = Array.from({ length: 3000 }, (_, i) => ({ id: `r${i}`, memberId: `m${i % 1300}`, n: (i * 7919) % 3001, at: i % 11 ? new Date(Date.UTC(2026, 0, 1 + (i % 300))) : null }));

function db(args: Record<string, unknown>) {
  const where = args.where as Record<string, { in: string[] }>;
  const [field, cond] = Object.entries(where)[0]!;
  let out = rows.filter((r) => cond.in.includes(String(r[field as keyof Row])));
  const order = orderOf(args.orderBy)!;
  out.sort((a, b) => {
    for (const [f, d] of order) {
      const x = a[f as keyof Row] instanceof Date ? (a[f as keyof Row] as Date).getTime() : a[f as keyof Row];
      const y = b[f as keyof Row] instanceof Date ? (b[f as keyof Row] as Date).getTime() : b[f as keyof Row];
      if (x === y) continue;
      const c = x === null ? -1 : y === null ? 1 : x! < y! ? -1 : 1;
      return d === "asc" ? c : -c;
    }
    return 0;
  });
  if (args.distinct) {
    const seen = new Set<string>();
    out = out.filter((r) => (seen.has(r.memberId) ? false : (seen.add(r.memberId), true)));
  }
  const skip = (args.skip as number) ?? 0;
  out = out.slice(skip, args.take === undefined ? undefined : skip + (args.take as number));
  if (args.select) out = out.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => (args.select as Record<string, boolean>)[k]))) as Row[];
  return out;
}

const ids = Array.from({ length: 1300 }, (_, i) => `m${i}`);
let calls = 0;
const run = async (a: unknown) => {
  calls++;
  return db(a as Record<string, unknown>);
};

describe("long lists on SQLite", () => {
  it("leaves a short list, or a list under another condition, alone", () => {
    expect(longIn({ where: { memberId: { in: ids.slice(0, IN_SLICE) } } })).toBeNull();
    expect(longIn({ where: { memberId: { in: ids, not: "x" } } })).toBeNull();
    expect(longIn({ where: { memberId: { in: ids } } })).toMatchObject({ field: "memberId" });
  });

  it("returns exactly what one query would: ordered with nulls first, distinct, skipped and taken, unselected fields dropped", async () => {
    for (const args of [
      { where: { memberId: { in: ids } } },
      { where: { memberId: { in: ids } }, orderBy: { n: "desc" } },
      { where: { memberId: { in: ids } }, orderBy: [{ at: "asc" }, { id: "asc" }], take: 40, skip: 7 },
      { where: { memberId: { in: ids } }, orderBy: [{ at: "desc" }, { id: "asc" }], distinct: ["memberId"], select: { memberId: true } },
    ]) {
      calls = 0;
      const got = (await inSlices("findMany", args, run)) as Row[];
      expect(calls).toBe(3);
      const want = db(args);
      if ((args as { orderBy?: unknown }).orderBy) expect(got).toEqual(want);
      else expect(new Set(got.map((r) => r.id))).toEqual(new Set(want.map((r) => r.id)));
    }
  });

  it("adds up counts, groups and bulk writes", async () => {
    const count = async (a: unknown) => db(a as Record<string, unknown>).length;
    expect(await inSlices("count", { where: { memberId: { in: ids } } }, count)).toBe(3000);
    expect(await inSlices("deleteMany", { where: { memberId: { in: ids } } }, async (a) => ({ count: await count(a) }))).toEqual({ count: 3000 });
    const groups = (await inSlices("groupBy", { by: ["memberId"], where: { memberId: { in: ids } }, orderBy: { memberId: "asc" } }, async (a) => {
      const g = new Map<string, number>();
      for (const r of db(a as Record<string, unknown>)) g.set(r.memberId, (g.get(r.memberId) ?? 0) + 1);
      return [...g].map(([memberId, n]) => ({ memberId, _count: n }));
    })) as { memberId: string; _count: number }[];
    expect(groups).toHaveLength(1300);
    expect(groups.reduce((s, g) => s + g._count, 0)).toBe(3000);
  });

  it("does not combine what it cannot combine exactly", async () => {
    expect(await inSlices("findMany", { where: { memberId: { in: ids } }, orderBy: { member: { name: "asc" } } }, run)).toBe(NOT_SLICED);
    expect(await inSlices("findMany", { where: { memberId: { in: ids } }, cursor: { id: "r1" } }, run)).toBe(NOT_SLICED);
    expect(await inSlices("groupBy", { by: ["n"], where: { memberId: { in: ids } } }, run)).toBe(NOT_SLICED);
    expect(await inSlices("aggregate", { where: { memberId: { in: ids } } }, run)).toBe(NOT_SLICED);
  });
});
