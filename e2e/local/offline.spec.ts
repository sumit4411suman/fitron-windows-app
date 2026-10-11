import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { EDITION } from "../env";
import { addMember, chargeGst, createPlan, expect, sell, test } from "../support";
import { firstRun, startLocalServer, type LocalServer, type Owner } from "./server";
import { addExpense } from "./helpers";

// Phase 11 / Phase 22 (offline): FITRON for Windows with the internet switched off. The server runs with
// offline-preload.cjs (name lookups fail, other hosts are unreachable, every attempt is logged) and the browser refuses
// every request that leaves this computer (and records it). The whole Gym Accounting day runs, then every console page
// opens, and neither side may have tried to go online. Local Edition only.
test.describe.configure({ mode: "serial" });
test.skip(EDITION !== "local", "Local Edition only (npm run e2e:local)");

const PORT = 3303;
const owner: Owner = { gym: "Offline Gym", name: "Kavya Iyer", email: "owner@offline.in", password: "a-long-password-1" };
let dataDir: string;
let serverLog: string;
let server: LocalServer;
let ctx: BrowserContext;
let page: Page;
const browserTried: string[] = [];

const serverTried = () => (existsSync(serverLog) ? readFileSync(serverLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind: string; host: string; stack: string }) : []);

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "fitron-offline-"));
  serverLog = path.join(dataDir, "network-attempts.jsonl");
  server = await startLocalServer(dataDir, PORT, {
    FITRON_LOCAL_SCHEDULER: "off",
    NODE_OPTIONS: `--require ${path.join(process.cwd(), "e2e", "local", "offline-preload.cjs")}`,
    FITRON_OFFLINE_LOG: serverLog,
  });
  ctx = await browser.newContext({ baseURL: server.url, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.route(
    (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
    (route) => {
      browserTried.push(route.request().url());
      return route.abort("internetdisconnected");
    },
  );
  await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${owner.email}`);
  page = await ctx.newPage();
});
test.afterAll(async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

// A request made by the browser itself, with its cookies. Playwright's side-channel request client does not send the
// Secure session cookie to http://127.0.0.1 (Chromium and WebView2 do), and a bounce to the login page is a 200 too.
async function browserGet(url: string) {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    const body = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, path: new URL(r.url).pathname, type: r.headers.get("content-type") ?? "", head: new TextDecoder().decode(body.slice(0, 200)) };
  }, url);
}

const noErrorScreen = async (where: string) => expect(page.getByText(/Something went wrong|This page hit a problem|Application error/i), where).toHaveCount(0);

test("the server really is offline: a lookup of the internet fails, this computer still answers", async () => {
  expect((await (await fetch(`${server.url}/api/health`)).json()).ok).toBe(true);
});

test("a whole Gym Accounting day works offline, without the server or the browser trying to go online", async () => {
  test.setTimeout(240_000);
  await firstRun(page, owner);
  await chargeGst(page);
  await createPlan(page, { name: "Monthly", months: 1, price: 1500 });
  const memberId = await addMember(page, "Asha Verma");

  // Sale with part payment: invoice with GST, then the balance.
  const invoiceId = await sell(page, memberId, { payNow: 1000 });
  await expect(page.getByText("PART PAID", { exact: true })).toBeVisible();
  await page.locator("#collect").getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("PAID", { exact: true })).toBeVisible();
  await noErrorScreen("invoice");

  // PDF of the GST invoice, made on this computer.
  const pdf = await browserGet(`/invoices/${invoiceId}/pdf`);
  expect(pdf.status).toBe(200);
  expect(pdf.type).toBe("application/pdf");
  expect(pdf.head.slice(0, 5)).toBe("%PDF-");

  await addExpense(page, { description: "Electricity bill", amount: 2400 });

  // Attendance: the front desk checks the member in.
  await page.goto("/attendance");
  await page.getByLabel("Find member").fill("Asha");
  await page.getByRole("button", { name: /Asha Verma/ }).click();
  await expect(page.getByText(/checked in|Asha Verma/i).first()).toBeVisible();

  // Search, reports and a download.
  const hits = await browserGet("/api/search?q=Asha");
  expect(hits.status).toBe(200);
  expect(hits.head).toContain("Asha Verma");
  for (const key of ["collections", "gst-invoices", "expenses", "dues"]) {
    await page.goto(`/reports/${key}`);
    await noErrorScreen(key);
    const csv = await browserGet(`/reports/${key}/csv`);
    expect({ status: csv.status, path: csv.path, csv: csv.type.startsWith("text/csv") }, key).toEqual({ status: 200, path: `/reports/${key}/csv`, csv: true });
  }

  // Accounting and the books.
  await page.goto("/accounting");
  await noErrorScreen("accounting");
  await expect(page.locator("main").getByText("₹1,500").first()).toBeVisible();

  // Backup works with no internet.
  await page.goto("/settings/backup");
  await page.getByRole("button", { name: "Back up now" }).click();
  await expect(page.getByText(/Backup saved as FITRON-Backup-/)).toBeVisible();

  expect(serverTried(), "the server did not try to reach the internet for core work").toEqual([]);
  expect(browserTried, "the browser did not try to load anything from the internet").toEqual([]);
});

// Every page of the console, offline: it opens without an error page, and nothing tried to go online. Online-only
// features may say they need the internet; they must not break the page.
const APP = path.join(__dirname, "../../src/app/(app)");
function pagesUnder(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith("[")) out.push(...pagesUnder(dir, `${prefix}/${e.name}`));
    else if (e.name === "page.tsx") out.push(prefix || "/");
  }
  return out;
}

test("every console page opens offline, and none of them tries to go online", async () => {
  test.setTimeout(300_000);
  const tabs = ["gym", "billing", "reminders", "wa", "int", "branches", "privacy", "help"].map((t) => `/settings?tab=${t}`);
  const routes = [...pagesUnder(APP).filter((r) => !r.startsWith("/fitron-admin")).sort(), ...tabs];
  expect(routes.length).toBeGreaterThan(30);
  const before = serverTried().length;
  const slow: string[] = [];
  for (const r of routes) {
    const t0 = Date.now();
    const res = await page.goto(r);
    const ms = Date.now() - t0;
    if (ms > 4_000) slow.push(`${r} ${ms}ms`);
    expect(res?.status(), r).toBeLessThan(500);
    await noErrorScreen(r);
  }
  expect(slow, "no page waits on the network").toEqual([]);
  expect(serverTried().slice(before).map((a) => a.host), "no page made the server go online").toEqual([]);
  expect(browserTried, "no page made the browser go online").toEqual([]);
});

// The online-only features, offline: each says what it needs instead of failing, pretending, or making the desk wait.
test("online-only features say they need the internet or WhatsApp, and never pretend they sent", async () => {
  test.setTimeout(180_000);
  await page.goto("/members");
  const memberId = await addMember(page, "Ravi Kumar");
  await sell(page, memberId, { payNow: 0 });
  const mode = async (value: "connector" | "demo") => {
    await page.goto("/settings?tab=wa");
    const form = page.locator('form:has(select[name="mode"])');
    await form.locator('select[name="mode"]').selectOption(value);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.locator('select[name="mode"]')).toHaveValue(value);
  };

  // The linked phone's connector is not running: the reminder is not sent, and the desk is told why, in red.
  await mode("connector");
  await page.goto(`/members/${memberId}`);
  await page.getByRole("button", { name: "Send payment reminder" }).click();
  await expect(page.getByText(/^Payment reminder not sent: Nothing is answering at http:\/\/127\.0\.0\.1:3131/)).toBeVisible();

  // The daily jobs that send on WhatsApp wait for it, without failing or alerting; the rest run.
  await page.goto("/settings/jobs");
  await page.getByRole("button", { name: /Run (today's jobs now|anything left for today)/ }).click();
  await expect(page.getByText("Waiting, and tried again within the hour:")).toBeVisible();
  await expect(page.getByText(/^Expiry reminders on WhatsApp: Nothing is answering at/)).toBeVisible();
  await expect(page.getByText("Churn risk for every member")).toBeVisible();

  // Not linked (demo): the reminder is saved, and called "not sent".
  await mode("demo");
  await page.goto(`/members/${memberId}`);
  await page.getByRole("button", { name: "Send payment reminder" }).click();
  await expect(page.getByText(/^Payment reminder saved, not sent: WhatsApp is not linked/)).toBeVisible();

  // Support tickets go by email only, which this computer has not set up: no form that would pretend to send.
  await page.goto("/settings?tab=help");
  await expect(page.getByText(/sends tickets by email, which is not set up on this computer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send to support" })).toHaveCount(0);

  // Fitron AI answers from the books on this computer.
  const ai = await page.evaluate(async () => {
    const r = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "How is this month going?" }] }) });
    return { status: r.status, events: (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string }) };
  });
  expect(ai.status).toBe(200);
  expect(ai.events.some((e) => e.type === "text")).toBe(true);
  expect(ai.events.filter((e) => e.type === "error")).toEqual([]);

  expect(serverTried(), "nothing tried to reach the internet").toEqual([]);
  expect(browserTried, "the browser did not try to load anything from the internet").toEqual([]);
});

