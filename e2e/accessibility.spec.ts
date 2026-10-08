import { readdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test as base, type Page } from "@playwright/test";
import { createPlan, expect, gymWithPlan, newContext, addMember, sell, type Gym } from "./support";

// Every page of the console, checked by axe (the accessibility engine behind Lighthouse) on a desktop and on a phone, in a
// gym that has business in it: a plan that is active and one that is not, a member, an invoice. An empty gym hides most
// of what can go wrong (tables, cards, the buttons on them), so the gym is made once per worker and shared.
//
// Checked: WCAG 2.0/2.1 level A and AA, and axe's best-practice rules, except heading-order. Headings skip a level on about
// thirty pages (a card title that is an h3 under the page's h1, with no h2 between); fixing it means restyling them, which
// is a separate piece of work. Everything else is expected to be clean, so a new problem fails the test that finds it.

const APP = path.join(__dirname, "../src/app/(app)");
function pagesUnder(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith("[")) out.push(...pagesUnder(dir, `${prefix}/${e.name}`));
    else if (e.name === "page.tsx") out.push(prefix || "/");
  }
  return out;
}

// The FITRON team's own screens answer only to the team. Tabs of a page are separate addresses to check.
const STATIC = pagesUnder(APP).filter((r) => !r.startsWith("/fitron-admin"));
const TABS = ["/settings?tab=reminders", "/settings?tab=privacy", "/settings?tab=branches", "/settings?tab=billing", "/settings?tab=help", "/accounting?tab=ledger", "/profile?tab=twostep", "/profile?tab=password", "/reports/collections"];

type Rich = { state: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>; gym: Gym; memberId: string; invoiceId: string };

const test = base.extend<{ page: Page; rich: Rich }, { richWorker: Rich }>({
  richWorker: [
    async ({ browser }, run) => {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const gym = await gymWithPlan(page, { name: "Quarterly", months: 3, price: 1500 }, { signupPlan: "enterprise" });
      await createPlan(page, { name: "Old monthly", months: 1, price: 800 });
      await page.goto("/plans");
      const card = page.locator("div").filter({ has: page.getByText("Old monthly", { exact: true }), hasText: "Deactivate" }).last();
      await card.getByRole("button", { name: "Deactivate" }).click();
      await expect(page.getByText("Inactive", { exact: true }), "one plan is now inactive").toBeVisible();
      const memberId = await addMember(page, "Asha Verma");
      const invoiceId = await sell(page, memberId);
      await run({ state: await ctx.storageState(), gym, memberId, invoiceId });
      await ctx.close();
    },
    { scope: "worker", timeout: 240_000 },
  ],
  rich: async ({ richWorker }, run) => run(richWorker),
  page: async ({ browser, rich }, run) => {
    const ctx = await newContext(browser, { storageState: rich.state });
    await run(await ctx.newPage());
    await ctx.close();
  },
});

const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } } as const;

async function audit(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .disableRules(["heading-order"])
    .analyze();
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ").slice(0, 110)).join("\n    ")}`);
}

for (const [device, size] of Object.entries(SIZES)) {
  test.describe(device, () => {
    for (const route of [...STATIC, ...TABS]) {
      test(route, async ({ page }) => {
        await page.setViewportSize(size);
        await page.goto(route);
        await expect(page.locator("main, [role=main]").first()).toBeVisible();
        expect(await audit(page)).toEqual([]);
      });
    }

    test("a member's page and an invoice", async ({ page, rich }) => {
      await page.setViewportSize(size);
      for (const url of [`/members/${rich.memberId}`, `/invoices/${rich.invoiceId}`]) {
        await page.goto(url);
        await expect(page.locator("main, [role=main]").first()).toBeVisible();
        expect(await audit(page), url).toEqual([]);
      }
    });
  });
}

test.describe("the public pages", () => {
  for (const [device, size] of Object.entries(SIZES)) {
    for (const url of ["/", "/gym-accounting", "/gym-management-software", "/gym-gst-billing", "/ai-personal-trainer", "/about", "/tools", "/tools/gym-profit-calculator", "/tools/calorie-calculator", "/signin", "/terms", "/refund", "/contact", "/privacy", "/login", "/login?tab=up&plan=professional&cycle=MONTHLY"]) {
      test(`${url} on a ${device}`, async ({ page }) => {
        await page.setViewportSize(size);
        // The home page fades its sections in as they are scrolled to. With reduced motion it shows them at once, so what is
        // audited is the settled page, not whichever frame of a fade happened to be on screen when the network went quiet.
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(url);
        await page.waitForLoadState("networkidle").catch(() => {});
        expect(await audit(page)).toEqual([]);
      });
    }
  }
});
