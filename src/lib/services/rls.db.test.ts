import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb } from "@/test/db";

describe.skipIf(!hasDb)("row-level security", () => {
  it("is on for every table, so a database API such as Supabase's can't read or change one", async () => {
    const rows = await db.$queryRaw<{ name: string }[]>`
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
      ORDER BY c.relname`;
    // A table added by a migration needs: ALTER TABLE "Name" ENABLE ROW LEVEL SECURITY;
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it("does not get in the app's way: the table owner still reads and writes", async () => {
    // The app connects as the table owner, which row-level security does not apply to. If this ever fails, the app is
    // connecting as a role that is not the owner and needs a policy (or the owner's login).
    expect(await db.organization.count()).toBeGreaterThanOrEqual(0);
    const gym = await db.organization.create({ data: { name: "RLS check" } });
    expect((await db.organization.findUniqueOrThrow({ where: { id: gym.id } })).name).toBe("RLS check");
  });
});
