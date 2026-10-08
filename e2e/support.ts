import { createHmac } from "node:crypto";
import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { Client } from "pg";
import { BASE_URL, DATABASE_URL } from "./env";

export { expect };
export const PASSWORD = "a-long-password-123";

// ---------------------------------------------------------------------------------------------------------------------
// Isolation. Every test makes its own gym (a name nobody else has), so tests never depend on each other or on what an
// earlier run left in the database. The app limits sign-ins and sign-ups per address (x-forwarded-for, which the proxy in
// production sets), so every browser context here comes from its own made-up address.

const rand = () => Math.random().toString(36).slice(2, 8);
export const unique = () => `${Date.now().toString(36)}${rand()}`;
const fakeIp = () => `10.${[1, 2, 3].map(() => 1 + Math.floor(Math.random() * 253)).join(".")}`;

/** Records CSP violations as they happen, for `violations(page)`. */
const RECORD_VIOLATIONS = () => {
  const w = window as unknown as { __csp: string[] };
  w.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.effectiveDirective} blocked ${e.blockedURI.slice(0, 80)}`));
};

/**
 * The welcome tour opens by itself, a moment after a person's first page, and covers the screen: a click that lands
 * while it is opening goes to the tour. Tests read "already seen" unless they are about the tour (it remembers that in
 * localStorage under fitron-tour-done-<email>).
 */
const TOUR_SEEN = () => {
  const get = Storage.prototype.getItem;
  Storage.prototype.getItem = function (this: Storage, key: string) {
    return key.startsWith("fitron-tour-done-") ? "1" : get.call(this, key);
  };
};

/**
 * The address each browser context appears to come from. Sent as x-forwarded-for, as the proxy in production does, but
 * only to our own server: a header like that on a request to another site (Google Fonts, say) makes the browser ask that
 * site's permission first, and the font is then refused. So it is added by a route on our origin, not as an extra header
 * for every request, and it can be changed mid-test (see signIn).
 */
const addresses = new WeakMap<BrowserContext, string>();
export const comeFrom = (ctx: BrowserContext, ip = fakeIp()) => void addresses.set(ctx, ip);

export async function newContext(browser: Browser, options: BrowserContextOptions = {}, { showTour = false } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: BASE_URL, locale: "en-IN", timezoneId: "Asia/Kolkata", ...options });
  comeFrom(ctx);
  await ctx.route(`${BASE_URL}/**`, (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": addresses.get(ctx)! } }));
  // The cookie banner would sit over the page; "all" is what pressing Accept stores.
  await ctx.addCookies([{ name: "fitron_consent", value: "all", url: BASE_URL }]);
  await ctx.addInitScript(RECORD_VIOLATIONS);
  if (!showTour) await ctx.addInitScript(TOUR_SEEN);
  return ctx;
}

export const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

/** Everything that went wrong in the browser while a page was used: uncaught errors, console errors, policy violations. */
export function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
  page.on("console", (m) => {
    // A missing image or an unauthorised call is the server answering; what matters here is code that breaks.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  return {
    problems,
    /** Problems so far plus any policy violation the page recorded. */
    async all() {
      return [...problems, ...(await violations(page).catch(() => []))];
    },
  };
}

export const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ---------------------------------------------------------------------------------------------------------------------
// The database, for what the app does not offer a screen for: changing a gym's plan, and reading what a screen wrote.

export async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

/** What the database says when it is asked to do something it must refuse. */
export async function sqlError(text: string): Promise<string> {
  return sql(text).then(
    () => "",
    (e: Error) => e.message,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// A second factor, worked out from the secret the way an authenticator app does it (RFC 6238), written again here
// rather than imported from the app, so a mistake in the app's own code cannot agree with itself.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(s: string) {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[\s=-]/g, "")) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit code an app shows for `secret` at a moment in time. */
export function totp(secret: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

// ---------------------------------------------------------------------------------------------------------------------
// Gyms and people.

export type Gym = { name: string; ownerName: string; email: string; password: string };

/**
 * Creates a gym the way a visitor does, on the Create account tab, and leaves `page` on its dashboard. A new gym lands on the
 * setup wizard first (src/app/onboarding): by default the helper skips it ("I'll finish this later"); `setup: "stay"` leaves the
 * page there, for tests about the wizard.
 */
export async function signUp(page: Page, { plan = "professional", tag = "gym", setup = "skip" }: { plan?: string; tag?: string; setup?: "skip" | "stay" } = {}): Promise<Gym> {
  const id = unique();
  const gym: Gym = { name: `E2E ${tag} ${id}`, ownerName: `Owner ${id}`, email: `e2e-${id}@example.com`, password: PASSWORD };
  await page.goto(`/login?tab=up&plan=${plan}&cycle=MONTHLY`);
  await expect(page.getByText("Create your Fitron account")).toBeVisible();
  await page.getByLabel("Your name").fill(gym.ownerName);
  await page.getByLabel("Email", { exact: true }).fill(gym.email);
  await page.getByLabel("Password").fill(gym.password);
  await page.locator("#ft-agree").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Set up your gym")).toBeVisible();
  await page.getByPlaceholder("Power Haus Gym").fill(gym.name);
  await page.getByPlaceholder("10-digit mobile").fill(`98765${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`);
  await page.getByPlaceholder("hello@yourgym.in").fill(`gym-${id}@example.com`);
  await page.getByPlaceholder("Shop / building, area").fill("1 Station Road");
  await page.getByPlaceholder("Bokaro").fill("Bokaro");
  await page.getByPlaceholder("827004").fill("827004");
  // The welcome tour opens by itself a moment after the first page and covers it, so a click can land on it. A person who
  // has seen it has this flag (src/components/product-tour.tsx); set it before the dashboard loads.
  await page.addInitScript((key) => localStorage.setItem(key, "1"), `fitron-tour-done-${gym.email}`);
  await page.getByRole("button", { name: "Create account and open Fitron" }).click();
  await page.waitForURL(/\/onboarding/);
  if (setup === "stay") return gym;
  await page.getByRole("button", { name: "I'll finish this later" }).click();
  await page.waitForURL(/\/dashboard/);
  return gym;
}

export async function signIn(page: Page, gym: Pick<Gym, "email" | "password">, password = gym.password) {
  // Sign-ins are limited per address (5 a minute); a test that signs in many times does not come from one address.
  comeFrom(page.context());
  await page.goto("/login");
  await page.getByLabel("Email").fill(gym.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
}

/** Moves a gym to another plan, as a payment confirmed in the FITRON admin would. */
export const setPlan = (email: string, plan: "starter" | "professional" | "enterprise") =>
  sql(`update "Organization" set plan = $1 where id = (select "orgId" from "User" where email = $2)`, [plan, email]);

// ---------------------------------------------------------------------------------------------------------------------
// What a front-desk person does, on the screens they use: the building blocks of the tests that need a gym with business in it.

export async function chargeGst(page: Page, rate = "18") {
  await page.goto("/settings?tab=billing");
  await page.getByLabel("Charge GST on invoices").check();
  await page.getByLabel("GST rate (%)").fill(rate);
  await page.getByLabel("Tax type").selectOption("CGST+SGST");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel("Charge GST on invoices")).toBeChecked();
}

export async function createPlan(page: Page, { name, months, price }: { name: string; months: number; price: number }) {
  await page.goto("/plans/new");
  await page.getByLabel("Plan name").fill(name);
  await page.getByLabel("Duration (months)").fill(String(months));
  await page.getByLabel("Price (₹)", { exact: true }).fill(String(price));
  await page.getByRole("button", { name: "Create plan" }).click();
  // Not toHaveURL(/\/plans/): that is also true on /plans/new, before the plan is saved.
  await page.waitForURL((u) => u.pathname === "/plans");
}

export async function addMember(page: Page, name: string): Promise<string> {
  await page.goto("/members/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").fill(`9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`);
  await page.getByLabel("Gender").selectOption({ index: 1 });
  await page.getByLabel("How did you hear about us?").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add member" }).click();
  await page.waitForURL(/\/members\/(?!new$)[^/?]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

export async function sell(page: Page, memberId: string, { payNow }: { payNow?: number } = {}): Promise<string> {
  await page.goto(`/members/${memberId}/sell`);
  if (payNow !== undefined) await page.getByLabel("Amount received now (₹)").fill(String(payNow));
  await page.getByRole("button", { name: "Create membership" }).click();
  await page.waitForURL(/\/invoices\/[^/?]+\?created=1/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

export async function gymWithPlan(page: Page, plan: { name: string; months: number; price: number }, { signupPlan = "professional" } = {}): Promise<Gym> {
  const gym = await signUp(page, { plan: signupPlan, tag: "sale" });
  await chargeGst(page);
  await createPlan(page, plan);
  return gym;
}

// ---------------------------------------------------------------------------------------------------------------------

type Shared = { gym: Gym; state: Awaited<ReturnType<BrowserContext["storageState"]>> };

export const test = base.extend<{ signedIn: Page }, { shared: Shared }>({
  // Every page in a test comes from its own address, with the cookie banner out of the way.
  context: async ({ browser }, run) => {
    const ctx = await newContext(browser);
    await run(ctx);
    await ctx.close();
  },
  // One Enterprise gym per worker (it opens every page), signed in once and shared by the tests that only look.
  shared: [
    async ({ browser }, run) => {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const gym = await signUp(page, { plan: "enterprise", tag: "shared" });
      await run({ gym, state: await ctx.storageState() });
      await ctx.close();
    },
    { scope: "worker" },
  ],
  signedIn: async ({ browser, shared }, run) => {
    const ctx = await newContext(browser, { storageState: shared.state });
    await run(await ctx.newPage());
    await ctx.close();
  },
});
