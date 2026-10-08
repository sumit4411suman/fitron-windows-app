import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSION_FEATURE, type Feature } from "@/lib/domain/features";

// A page is kept from a gym whose plan doesn't open it by requirePermission, but a download route has no page in
// front of it and must check the plan itself. These three used to check only the role.
const me = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth/current", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/current")>()),
  getCurrentUser: vi.fn(async () => me.user),
}));

import { GET as accountingCsv } from "./accounting/csv/route";
import { GET as expensesCsv } from "./expenses/csv/route";
import { GET as purchasesCsv } from "./purchases/csv/route";
import { GET as reportCsv } from "./reports/[key]/csv/route";
import { GET as reportXls } from "./reports/[key]/xls/route";

/** A signed-in user whose role may do everything and whose plan opens `opens` (a Starter gym opens nothing). */
const user = (opens: Feature[] | "all") => ({ id: "u", orgId: "o", can: () => true, has: (f: Feature) => opens === "all" || opens.includes(f), planBlocked: false });
const call = (get: (...a: never[]) => Promise<Response> | Response, url: string, key?: string) =>
  Promise.resolve((get as (r: Request, c: unknown) => Promise<Response> | Response)(new Request(url), { params: Promise.resolve({ key }) })).then(
    (r) => r.status,
    () => "got past the plan check" as const, // the fake user then fails inside the data layer, which is after the gate
  );

const routes = [
  ["Accounting CSV", accountingCsv, "http://x/accounting/csv?kind=income", undefined],
  ["Purchases CSV", purchasesCsv, "http://x/purchases/csv", undefined],
  ["report CSV (Purchases by month)", reportCsv, "http://x/reports/pur-month/csv", "pur-month"],
  ["report Excel (Purchases by month)", reportXls, "http://x/reports/pur-month/xls", "pur-month"],
  ["report Excel (Fixed asset register)", reportXls, "http://x/reports/assets/xls", "assets"],
] as const;

beforeEach(() => {
  me.user = null;
});

describe("downloads that belong to a plan feature", () => {
  it.each(routes)("%s is refused to a gym on Starter", async (_n, get, url, key) => {
    me.user = user([]);
    expect(await call(get as never, url, key)).toBe(403);
  });

  it.each(routes)("%s is not blocked for a gym whose plan opens Accounting", async (_n, get, url, key) => {
    me.user = user(["accounting"]);
    expect(await call(get as never, url, key)).not.toBe(403);
  });

  // A gym whose plan has ended keeps its data but cannot take it out (the pages send it to /plan-ended; a download has no
  // page in front of it, so the route answers 402 itself). These four used not to.
  it.each([...routes, ["Expenses CSV", expensesCsv, "http://x/expenses/csv", undefined] as const])("%s answers 402 to a gym whose plan has ended", async (_n, get, url, key) => {
    me.user = { ...user("all"), planBlocked: true };
    expect(await call(get as never, url, key)).toBe(402);
  });

  it("still refuses someone who isn't signed in", async () => {
    expect(await call(reportXls as never, "http://x/reports/assets/xls", "assets")).toBe(401);
  });
});

// The same mistake, found by reading the code: a route that checks a permission which belongs to a plan feature
// (PERMISSION_FEATURE) with u.can(...) alone, without canUsePermission(...) or a u.has(...) check.
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? routeFiles(p) : n === "route.ts" ? [p] : [];
  });
}

describe("every download route under the app", () => {
  const files = routeFiles(__dirname).map((f) => ({ f: f.replaceAll("\\", "/"), s: readFileSync(f, "utf8") }));

  it("checks the plan wherever it checks a permission that belongs to a plan feature", () => {
    const bad = files
      .filter(({ s }) => [...s.matchAll(/u\.can\("([a-z.]+)"\)/g)].some((m) => (PERMISSION_FEATURE as Record<string, unknown>)[m[1]!]) && !/canUsePermission\(|\.has\(/.test(s))
      .map((x) => x.f.slice(x.f.indexOf("src/")));
    expect(bad).toEqual([]);
  });

  // Left open on purpose, so that closing one is a decision and not an oversight: the two pictures a page shows (a person's
  // photo, the gym's logo), and the gym's own backup file, which a gym whose plan has lapsed can still take away.
  const OPEN_TO_A_LAPSED_PLAN = ["profile/photo/[id]/route.ts", "settings/logo/route.ts", "settings/backup/[id]/download/route.ts"];

  it("answers 402 to a gym whose plan has ended, wherever it reads the signed-in user (the FITRON team's own screens and the three above aside)", () => {
    const bad = files
      .filter(({ f, s }) => /getCurrentUser\(/.test(s) && !/planBlocked/.test(s) && !f.includes("/fitron-admin/") && !OPEN_TO_A_LAPSED_PLAN.some((x) => f.endsWith(x)))
      .map((x) => x.f.slice(x.f.indexOf("src/")));
    expect(bad).toEqual([]);
  });

  it("checks the report's plan feature wherever it checks the report's permission", () => {
    const bad = files.filter(({ s }) => s.includes("def.perm") && !s.includes("def.feature")).map((x) => x.f.slice(x.f.indexOf("src/")));
    expect(bad).toEqual([]);
  });
});
