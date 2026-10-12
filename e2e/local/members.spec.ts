import { expect, signUp, sql, test, unique } from "../support";
import { orgOf } from "./helpers";

// Phase 22: members on FITRON for Windows (and on fitron.in: these module specs run on both editions). Added, found by
// name and by phone, edited, a phone that already belongs to someone refused, deleted with a reason and brought back,
// every step in the audit log.
test("a member is added, found, edited, kept unique by phone, deleted with a reason and restored", async ({ page }) => {
  const gym = await signUp(page, { tag: "members" });
  const orgId = await orgOf(gym.email);
  const name = `Lakshmi ${unique()}`;
  const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  await page.goto("/members/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("Gender").selectOption({ index: 1 });
  await page.getByLabel("How did you hear about us?").selectOption({ index: 1 });
  await page.getByRole("checkbox", { name: /^Privacy consent/ }).check();
  await page.getByRole("button", { name: "Add member" }).click();
  await page.waitForURL(/\/members\/(?!new$)[^/?]+$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const [row] = await sql<{ code: string; phone: string; deletedAt: unknown }>(`select code, phone, "deletedAt" from "Member" where id = $1`, [id]);
  expect(row).toMatchObject({ phone, deletedAt: null });
  expect(row!.code).toMatch(/^FT-\d+$/);

  for (const q of [name.split(" ")[0]!, phone.slice(-6), row!.code]) {
    await page.goto(`/members?q=${encodeURIComponent(q)}`);
    await expect(page.getByRole("link", { name }).first(), `found by ${q}`).toBeVisible();
  }

  await page.goto(`/members/${id}/edit`);
  await page.getByLabel("Full name").fill(`${name} Iyer`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(new RegExp(`/members/${id}$`));
  await expect(page.getByRole("heading", { name: `${name} Iyer` })).toBeVisible();

  // The same phone for a second member is refused, naming who has it.
  await page.goto("/members/new");
  await page.getByLabel("Full name").fill("Someone Else");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("Gender").selectOption({ index: 1 });
  await page.getByLabel("How did you hear about us?").selectOption({ index: 1 });
  await page.getByRole("checkbox", { name: /^Privacy consent/ }).check();
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText(`This phone number already belongs to ${name} Iyer (${row!.code}).`).first()).toBeVisible();

  await page.goto(`/members/${id}?do=delete`);
  await page.getByLabel("Reason (recorded in the audit log) *").fill("Joined by mistake");
  await page.getByRole("button", { name: "Delete member" }).click();
  await expect.poll(async () => (await sql<{ deletedAt: unknown }>(`select "deletedAt" from "Member" where id = $1`, [id]))[0]!.deletedAt).not.toBeNull();
  await page.goto(`/members?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("link", { name: `${name} Iyer` })).toHaveCount(0);

  await page.goto("/members?deleted=1");
  const gone = page.locator("div").filter({ hasText: `${name} Iyer` }).filter({ hasText: "Joined by mistake" }).filter({ has: page.getByRole("button", { name: "Restore" }) }).last();
  await gone.getByRole("button", { name: "Restore" }).click();
  await expect.poll(async () => (await sql<{ deletedAt: unknown }>(`select "deletedAt" from "Member" where id = $1`, [id]))[0]!.deletedAt).toBeNull();
  const actions = (await sql<{ action: string }>(`select action from "AuditLog" where "orgId" = $1 and "entityId" = $2 order by id`, [orgId, id])).map((a) => a.action);
  expect(actions).toEqual(expect.arrayContaining(["member.create", "member.update", "member.delete", "member.restore"]));
});
