import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// One SQLite library per process. Prisma's adapter and FITRON's own backup, restore and migration code must load the
// same better-sqlite3: two copies of SQLite on one file break its locking (closing a file in one copy drops the other
// copy's locks), which shows up as stale reads and "disk I/O error". Keep the version in package.json equal to the
// adapter's (npm then installs one copy); this test fails if a second copy comes back.
describe("SQLite library", () => {
  it("is the same copy for the Prisma adapter and for FITRON's own code", () => {
    const req = createRequire(import.meta.url);
    const fromAdapter = createRequire(req.resolve("@prisma/adapter-better-sqlite3")).resolve("better-sqlite3");
    expect(fromAdapter).toBe(req.resolve("better-sqlite3"));
  });
});
