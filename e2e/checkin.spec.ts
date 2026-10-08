import { addMember, expect, gymWithPlan, newContext, sell, sql, test, unique, watch } from "./support";

// The front-desk QR poster (Attendance › QR) opens a public page where a member types their mobile number. Run here the way
// it is used: the desk prints the poster, a member who is not signed in anywhere opens its address on their phone.

test("a member checks in from the poster's address without signing in, and the desk sees the visit", async ({ page, browser }) => {
  await gymWithPlan(page, { name: `Monthly ${unique()}`, months: 1, price: 1000 });
  const name = `Asha ${unique()}`;
  const memberId = await addMember(page, name);
  await sell(page, memberId);
  const [m] = await sql<{ phone: string; branchId: string; branch: string; gym: string }>(
    `select m.phone, m."branchId", b.name as branch, o.name as gym from "Member" m join "Organization" o on o.id = m."orgId" join "Branch" b on b.id = m."branchId" where m.id = $1`,
    [memberId],
  );

  // What the desk prints: the poster shows the address the QR holds.
  await page.goto("/attendance");
  await page.getByRole("button", { name: "QR code" }).click();
  const posterAddress = await page.getByText(new RegExp(`/c/[a-z0-9-]*/${m!.branchId}$`)).first().innerText();
  expect(new URL(posterAddress).pathname).toMatch(/^\/c\/[a-z0-9-]+\/[a-z0-9]+$/);

  // The member, on their own phone.
  const ctx = await newContext(browser, { viewport: { width: 390, height: 800 } });
  const phone = await ctx.newPage();
  const seen = watch(phone);
  await phone.goto(new URL(posterAddress).pathname);
  await expect(phone.getByRole("heading", { name: m!.gym })).toBeVisible();
  await expect(phone.getByText(m!.branch, { exact: true })).toBeVisible();

  // A number that isn't a member's gets the same plain answer as every other refusal.
  await phone.getByLabel("Your mobile number").fill("9000000001");
  await phone.getByRole("button", { name: "Check in" }).click();
  await expect(phone.getByText("We couldn't check you in. Please ask at the front desk.")).toBeVisible();
  // Not a mobile number at all: asked again.
  await phone.getByLabel("Your mobile number").fill("12345");
  await phone.getByRole("button", { name: "Check in" }).click();
  await expect(phone.getByText("Enter your 10-digit mobile number.")).toBeVisible();

  await phone.getByLabel("Your mobile number").fill(m!.phone);
  await phone.getByRole("button", { name: "Check in" }).click();
  await expect(phone.getByRole("status")).toContainText("Welcome, Asha");
  expect(await seen.all(), "nothing broke, and the policy blocked nothing").toEqual([]);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "no sideways scroll on a phone").toBeLessThanOrEqual(0);

  // Opening it again, the same member is told they're already in, and the desk has one visit, by QR.
  await phone.reload();
  await phone.getByLabel("Your mobile number").fill(m!.phone);
  await phone.getByRole("button", { name: "Check in" }).click();
  await expect(phone.getByRole("status")).toContainText("already checked in");
  const visits = await sql<{ method: string; createdById: string | null }>(`select method, "createdById" from "Attendance" where "memberId" = $1`, [memberId]);
  expect(visits).toEqual([{ method: "QR", createdById: null }]);

  await page.goto("/attendance");
  await expect(page.getByText(name).first()).toBeVisible();
  await ctx.close();
});

test("a poster for a branch that doesn't exist opens a not-found page, not a form", async ({ browser }) => {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  const res = await page.goto("/c/some-gym/nosuchbranch");
  expect(res?.status()).toBe(404);
  await expect(page.getByLabel("Your mobile number")).toHaveCount(0);
  await ctx.close();
});

test("the check-in page stays out of search results", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toMatch(/Disallow: \/c\//);
});
