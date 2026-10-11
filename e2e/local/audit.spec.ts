import { addMember, expect, signUp, sql, test, unique } from "../support";
import { noErrorScreen, orgOf } from "./helpers";

// Audit logs (module 12). Every change leaves a row, chained by hash, which nobody can edit.
test("adding a member is in the audit log, chained, and the log cannot be changed", async ({ page }) => {
  const gym = await signUp(page, { tag: "audit" });
  await addMember(page, `Pooja ${unique()}`);
  await page.goto("/audit");
  await noErrorScreen(page);
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();

  const orgId = await orgOf(gym.email);
  const rows = await sql<{ id: number; hash: string | null; prevHash: string | null; action: string }>(`select id, hash, "prevHash", action from "AuditLog" where "orgId" = $1 order by id`, [orgId]);
  expect(rows.some((r) => r.action.startsWith("member."))).toBe(true);
  for (let i = 1; i < rows.length; i++) if (rows[i]!.hash) expect(rows[i]!.prevHash, "each entry chains onto the one before").toBe(rows[i - 1]!.hash);
  await expect(sql(`update "AuditLog" set action = 'x' where id = $1`, [rows[0]!.id])).rejects.toThrow(/append-only/);
});
