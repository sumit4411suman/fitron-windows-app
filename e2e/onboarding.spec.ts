import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, horizontalOverflow, signIn, signOut, signUp, sql, test, unique } from "./support";

// The first-run setup (src/app/onboarding): a gym that has just signed up answers a few steps before the console opens.

const heading = (page: Page, name: string) => expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
const next = (page: Page, name = "Continue") => page.getByRole("button", { name, exact: true }).click();
const orgOf = async (email: string) => (await sql<{ orgId: string }>(`select "orgId" from "User" where email = $1`, [email]))[0]!.orgId;
const GSTIN = "20ABCDE1234F1Z5";

test.describe("first-run setup", () => {
  test("a new gym goes through every step and ends with all of it in place", async ({ page }) => {
    const gym = await signUp(page, { tag: "setup", setup: "stay" });
    const staffEmail = `asha-${unique()}@example.com`;

    await heading(page, "Billing & GST");
    await expect(page.locator("aside").getByText("Step 1 of 8")).toBeVisible();
    await page.getByLabel("My gym is GST registered and charges GST").check();
    await page.getByLabel("GSTIN").fill(GSTIN);
    await page.getByLabel("GST rate (%)").selectOption("12");
    await page.getByLabel("Invoice prefix").fill("fit-");
    await page.getByLabel("First invoice number").fill("2501");
    await next(page);

    await heading(page, "Your branch");
    await page.getByLabel("Branch name").fill("City Centre");
    await page.getByLabel("Opening hours").fill("05:30 – 22:30");
    await page.getByLabel("Branch manager").fill("Ravi Kumar");
    await next(page);

    await heading(page, "Membership plans");
    await expect(page.getByLabel("Plan name")).toHaveCount(4);
    await page.getByLabel("Price (₹)").first().fill("1,600");
    await page.getByRole("button", { name: "Remove plan Annual" }).click();
    await expect(page.getByLabel("Plan name")).toHaveCount(3);
    await next(page);

    await heading(page, "Your team");
    await page.getByLabel("Name", { exact: true }).fill("Asha Rao");
    await page.getByLabel("Role").selectOption("Trainer");
    await page.getByLabel("Mobile").fill("98765 43211");
    await page.getByLabel("Email (they sign in with it)").fill(staffEmail);
    await page.getByLabel("First password").fill("first-pass-123");
    await next(page);

    await heading(page, "WhatsApp & reminders");
    await page.getByLabel("Birthday wishes").uncheck();
    await next(page);

    await heading(page, "Opening balances");
    await page.getByLabel("Cash in hand today (₹)").fill("5000");
    await page.getByLabel("Bank balance today (₹)").fill("25,000.50");
    await next(page);

    await heading(page, "Your data");
    await expect(page.getByLabel("Start with an empty gym")).toBeChecked();
    await next(page);

    await heading(page, "Review");
    await expect(page.getByText(`${GSTIN} · 12% CGST+SGST`)).toBeVisible();
    await expect(page.getByText("FIT-2501 onwards")).toBeVisible();
    await expect(page.getByText("Monthly ₹1,600, Quarterly ₹4,000, Half-Yearly ₹7,500")).toBeVisible();
    await expect(page.getByText("Asha Rao (Trainer)")).toBeVisible();
    await expect(page.getByText("Cash ₹5,000 · Bank ₹25,000.50")).toBeVisible();
    await next(page, "Finish setup");

    await page.waitForURL(/\/dashboard\?welcome=1/);
    await expect(page.getByText("Your gym is set up.")).toBeVisible();
    await expect(page.getByText("Your gym setup isn't finished")).toHaveCount(0);

    // What was set up is really there.
    const orgId = await orgOf(gym.email);
    expect(await sql(`select name, price, "regFee" from "MembershipPlan" where "orgId" = $1 order by months`, [orgId])).toEqual([
      { name: "Monthly", price: 160000, regFee: 50000 },
      { name: "Quarterly", price: 400000, regFee: 50000 },
      { name: "Half-Yearly", price: 750000, regFee: 0 },
    ]);
    expect((await sql<{ value: { enabled: boolean; gstin: string } }>(`select value from "Setting" where "orgId" = $1 and key = 'tax'`, [orgId]))[0]!.value).toMatchObject({ enabled: true, gstin: GSTIN });
    expect((await sql<{ next: number }>(`select next from "Sequence" where "orgId" = $1 and name = 'invoice'`, [orgId]))[0]!.next).toBe(2501);
    expect((await sql<{ value: { status: string; draft: unknown } }>(`select value from "Setting" where "orgId" = $1 and key = 'onboarding'`, [orgId]))[0]!.value).toMatchObject({ status: "DONE", draft: null });

    // The wizard is over: it does not come back, from the address or from the dashboard.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard/);

    // The person added on the Team step can sign in with the password typed there, and sees the Trainer's view.
    await signOut(page);
    await signIn(page, { email: staffEmail, password: "first-pass-123" });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Trainer view")).toBeVisible();
  });

  test("says what is wrong on a step and stays on it until it is fixed", async ({ page }) => {
    await signUp(page, { tag: "wrong", setup: "stay" });
    await page.getByLabel("My gym is GST registered and charges GST").check();
    await next(page);
    await expect(page.locator("main").getByRole("alert")).toContainText("GSTIN should be 15 characters");
    await heading(page, "Billing & GST");

    await page.getByLabel("GSTIN").fill("not-a-gstin");
    await next(page);
    await expect(page.locator("main").getByRole("alert")).toContainText("GSTIN should be 15 characters");

    // Turning GST off needs no GSTIN, and the message goes away with the change.
    await page.getByLabel("My gym is GST registered and charges GST").uncheck();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await next(page);
    await heading(page, "Your branch");

    await page.getByLabel("Opening hours").fill("");
    await next(page);
    await expect(page.locator("main").getByRole("alert")).toContainText("Enter opening hours.");
    await heading(page, "Your branch");
  });

  test("Back and the finished steps in the list go back, with what was typed still there", async ({ page }) => {
    await signUp(page, { tag: "back", setup: "stay" });
    await page.getByLabel("Invoice prefix").fill("zz-");
    await next(page);
    await page.getByLabel("Branch name").fill("Back Fit");
    await next(page);
    await heading(page, "Membership plans");

    await page.getByRole("button", { name: "Back" }).click();
    await heading(page, "Your branch");
    await expect(page.getByLabel("Branch name")).toHaveValue("Back Fit");

    await page.locator("aside").getByRole("button", { name: /Billing & GST/ }).click();
    await heading(page, "Billing & GST");
    await expect(page.getByLabel("Invoice prefix")).toHaveValue("ZZ-");
    // A step that has not been reached cannot be jumped to.
    await expect(page.locator("aside").getByRole("button", { name: /Membership plans|Plans/ })).toHaveCount(0);
  });

  test("on a phone, the setup can be skipped too", async ({ page }) => {
    await signUp(page, { tag: "phone-skip", setup: "stay" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/onboarding");
    await page.getByRole("button", { name: "I'll finish this later" }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByText("Your gym setup isn't finished")).toBeVisible();
  });

  test("a gym that has not finished is sent back to setup, can skip it, and is reminded", async ({ page }) => {
    await signUp(page, { tag: "skip", setup: "stay" });
    await page.goto("/dashboard");
    await expect(page, "the dashboard waits for the setup").toHaveURL(/\/onboarding/);

    await page.getByRole("button", { name: "I'll finish this later" }).click();
    await page.waitForURL(/\/dashboard/);
    await expect(page.getByText("Your gym setup isn't finished")).toBeVisible();

    await page.goto("/members");
    await expect(page, "once skipped, the rest of the console is open").toHaveURL(/\/members/);

    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Finish setup" }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await heading(page, "Billing & GST");
  });

  test("carries on where the owner left off after leaving the page", async ({ page }) => {
    await signUp(page, { tag: "resume", setup: "stay" });
    await page.getByLabel("Invoice prefix").fill("res-");
    await next(page);
    await heading(page, "Your branch");
    await page.getByLabel("Branch name").fill("Resume Fit");
    await next(page);
    await heading(page, "Membership plans");

    await page.goto("/onboarding");
    await heading(page, "Membership plans");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Branch name")).toHaveValue("Resume Fit");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Invoice prefix")).toHaveValue("RES-");
  });

  test("never keeps a team member's password in the saved answers", async ({ page }) => {
    const gym = await signUp(page, { tag: "pw", setup: "stay" });
    await next(page);
    await next(page);
    await next(page);
    await heading(page, "Your team");
    await page.getByLabel("Name", { exact: true }).fill("Asha Rao");
    await page.getByLabel("Mobile").fill("9876543211");
    await page.getByLabel("Email (they sign in with it)").fill(`pw-${unique()}@example.com`);
    await page.getByLabel("First password").fill("never-store-this-1");
    await next(page);
    await heading(page, "WhatsApp & reminders");
    const [row] = await sql<{ v: string }>(`select value::text as v from "Setting" where "orgId" = $1 and key = 'onboarding'`, [await orgOf(gym.email)]);
    expect(row!.v).toContain("Asha Rao");
    expect(row!.v).not.toContain("never-store-this-1");
  });

  test("a Starter gym is only asked what its plan opens", async ({ page }) => {
    await signUp(page, { plan: "starter", tag: "starter", setup: "stay" });
    const rail = page.locator("aside");
    await expect(rail.getByText("Step 1 of 5")).toBeVisible();
    for (const label of ["Billing & GST", "Branch", "Plans", "Data", "Review"]) await expect(rail.getByText(label, { exact: true })).toBeVisible();
    for (const label of ["Team", "WhatsApp", "Opening balances"]) await expect(rail.getByText(label, { exact: true })).toHaveCount(0);
    await next(page);
    await next(page);
    await heading(page, "Membership plans");
    await next(page);
    await heading(page, "Your data");
  });

  test("the import choice sends the owner to the import page", async ({ page }) => {
    await signUp(page, { plan: "starter", tag: "import", setup: "stay" });
    await next(page);
    await next(page);
    await next(page);
    await heading(page, "Your data");
    await page.getByLabel("Import my members").check();
    await next(page);
    await heading(page, "Review");
    await next(page, "Finish setup");
    await page.waitForURL(/\/settings\/import/);
  });
});

const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } } as const;

test.describe("accessibility and small screens", () => {
  for (const [device, size] of Object.entries(SIZES)) {
    test(`every step reads and fits on a ${device}`, async ({ page }) => {
      await page.setViewportSize(size);
      await signUp(page, { tag: `a11y-${device}`, setup: "stay" });
      for (let step = 0; step < 8; step++) {
        await expect(page.locator("main")).toBeVisible();
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).disableRules(["heading-order"]).analyze();
        expect(result.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), `step ${step + 1}`).toEqual([]);
        expect(await horizontalOverflow(page), `step ${step + 1} scrolls sideways`).toBeLessThanOrEqual(0);
        if (step < 7) await next(page, step === 3 ? "Skip for now" : "Continue");
      }
    });
  }
});
