import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSchema } from "./meta";
import { renderModel } from "../../../scripts/sync-schema";
import { triggerNames } from "./triggers";

// The generated field metadata matches the schema, and every synced table records its changes on both databases.

const root = path.join(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("sync schema", () => {
  it("model.generated.ts is up to date (npx tsx scripts/sync-schema.ts)", () => {
    expect(read("src/lib/sync/model.generated.ts")).toBe(renderModel(parseSchema(read("prisma/schema.prisma"))));
  });

  it("every synced table has its change-capture trigger on PostgreSQL and on SQLite", () => {
    const pg = read("prisma/migrations/20261011200000_cloud_sync/migration.sql");
    const sqlite = read("prisma/local-migrations/0003_cloud_sync/migration.sql");
    for (const n of triggerNames("pg")) expect(pg, n).toContain(`CREATE FUNCTION "${n}"()`);
    for (const n of triggerNames("sqlite")) expect(sqlite, n).toContain(`CREATE TRIGGER "${n}"`);
  });
});
