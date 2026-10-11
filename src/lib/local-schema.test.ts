import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toLocalSchema } from "../../scripts/local-schema";

// prisma/schema.local.prisma is generated from prisma/schema.prisma (scripts/local-schema.ts). The two must not drift.
const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), "utf8");

describe("the Local Edition schema", () => {
  const cloud = read("prisma/schema.prisma");
  const local = read("prisma/schema.local.prisma");

  it("is the Cloud schema converted for SQLite (run `npx tsx scripts/local-schema.ts` after changing prisma/schema.prisma)", () => {
    expect(local).toBe(toLocalSchema(cloud));
  });

  it("keeps every model and field of the Cloud schema", () => {
    const models = (s: string) => s.match(/^model \w+/gm)!.sort();
    expect(models(local)).toEqual(models(cloud));
    const fields = (s: string) => s.match(/^\s+\w+\s+(String|Int|BigInt|Boolean|DateTime|Decimal|Json|Bytes|Float)(\[\])?\??/gm)!.map((f) => f.trim().split(/\s+/)[0]);
    expect(fields(local)).toEqual(fields(cloud));
  });

  it("stores lists as JSON text and carries no PostgreSQL native types", () => {
    expect(local).not.toMatch(/String\[\]/);
    expect(local).not.toMatch(/@db\./);
    expect(local).toContain('provider = "sqlite"');
    expect(local).toContain('tags               String @default("[]")');
  });
});
