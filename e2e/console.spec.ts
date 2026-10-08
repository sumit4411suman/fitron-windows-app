import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, horizontalOverflow, test, watch } from "./support";

// Every page of the console, on a desktop and on a phone: it opens (no redirect, no error page), nothing in the browser
// throws, the Content-Security-Policy blocks nothing, and the page does not scroll sideways. The list of pages is read
// from the source tree, so a page added tomorrow is covered tomorrow.

const APP = path.join(__dirname, "../src/app/(app)");

function pagesUnder(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith("[")) out.push(...pagesUnder(dir, `${prefix}/${e.name}`));
    else if (e.name === "page.tsx") out.push(prefix || "/");
  }
  return out;
}

// The FITRON team's own screens answer only to the team, not to a gym.
const TEAM_ONLY = /^\/fitron-admin/;
const ROUTES = pagesUnder(APP)
  .filter((r) => !TEAM_ONLY.test(r))
  .sort();

const SIZES = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;

test("the list of pages is not empty (the source tree was read)", () => {
  expect(ROUTES.length).toBeGreaterThan(30);
  expect(ROUTES).toContain("/dashboard");
  expect(ROUTES).toContain("/settings/billing");
});

for (const [device, size] of Object.entries(SIZES)) {
  test.describe(device, () => {
    for (const route of ROUTES) {
      test(route, async ({ signedIn: page }) => {
        await page.setViewportSize(size);
        const seen = watch(page);
        const response = await page.goto(route);
        expect(response?.status(), "the page answers").toBe(200);
        expect(new URL(page.url()).pathname, "and is not sent somewhere else").toBe(route);
        await expect(page.locator("main, [role=main]").first(), "and shows its content").toBeVisible();
        await expect(page.getByText(/This page hit a problem on our side/), "not the error page").toHaveCount(0);
        // Late errors (a component that fails after the page is shown) arrive a moment after load.
        await page.waitForLoadState("networkidle").catch(() => {});
        expect(await seen.all(), "nothing broke in the browser").toEqual([]);
        expect(await horizontalOverflow(page), "the page does not scroll sideways").toBeLessThanOrEqual(1);
      });
    }
  });
}
