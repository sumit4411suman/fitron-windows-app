import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { addMember, chargeGst, createPlan, sell, signUp, sql, type Gym } from "../support";
import { firstRun, startLocalServer, type LocalServer } from "../local/server";

// Cloud sync, end to end (npm run e2e:sync): fitron.in on PostgreSQL and FITRON for Windows on SQLite, two servers from
// the same build, linked as a gym owner links them, the computer reaching fitron.in through a connection this test can
// cut. Every check reads both databases, and money is compared in paise.

test.skip(process.env.E2E_SYNC !== "1", "npm run e2e:sync runs this, with its own fitron.in database");
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const CLOUD_PORT = 3400;
const LOCAL_PORT = 3401;
const PROXY_PORT = 3402;

/** The computer's connection to fitron.in: on, cut, or cut after each request went through (the answer is lost). */
function proxy() {
  let mode: "on" | "cut" | "drop-answers" = "on";
  const open = new Set<net.Socket>();
  const server = net.createServer((client) => {
    if (mode === "cut") return void client.destroy();
    const up = net.connect(CLOUD_PORT, "127.0.0.1");
    open.add(client).add(up);
    const close = () => {
      client.destroy();
      up.destroy();
      open.delete(client);
      open.delete(up);
    };
    client.on("data", (d) => up.write(d));
    up.on("data", (d) => (mode === "drop-answers" ? close() : client.write(d)));
    for (const s of [client, up]) {
      s.on("error", close);
      s.on("close", close);
    }
  });
  server.listen(PROXY_PORT, "127.0.0.1");
  return {
    set(m: typeof mode) {
      mode = m;
      if (m !== "on") for (const s of open) s.destroy();
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** A PDF of `size` bytes whose content says which side made it. */
function pdf(size: number, mark: string) {
  const b = Buffer.alloc(size, mark.charCodeAt(0));
  b.write(`%PDF-1.7\n% ${mark}\n`, 0);
  return b;
}

/** Every file under a folder, by name. */
function filesUnder(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) out.set(e.name, path.join(e.parentPath, e.name));
  return out;
}

async function uploadDocument(p: Page, memberId: string, title: string, body: Buffer) {
  await p.goto(`/members/${memberId}?tab=documents`);
  const form = p.locator("#upload");
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("File", { exact: true }).setInputFiles({ name: `${title}.pdf`, mimeType: "application/pdf", buffer: body });
  await form.getByRole("button", { name: "Upload document" }).click();
  await expect(p.getByText(title).first()).toBeVisible();
}

let cloud: LocalServer;
let local: LocalServer;
let link: ReturnType<typeof proxy>;
let cloudDir: string;
let localDir: string;
let gym: Gym;
let cloudPage: Page;
let localPage: Page;

/** A query on the computer's database (read-only, its own connection, as an inspector would). */
function here<T>(query: string, ...args: unknown[]): T[] {
  const db = new Database(path.join(localDir, "data", "fitron.db"), { readonly: true, fileMustExist: true });
  try {
    return db.prepare(query).all(...args) as T[];
  } finally {
    db.close();
  }
}

async function eventually<T>(what: string, fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out after ${ms / 1000} s waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const cloudInvoice = async (id: string) => (await sql<{ number: string; total: number; tax: number }>(`select number, total, tax from "Invoice" where id = $1`, [id]))[0];
const cloudPaid = async (invoiceId: string) => (await sql<{ n: number; paid: number }>(`select count(*)::int n, coalesce(sum(amount), 0)::int paid from "Payment" where "invoiceId" = $1 and status = 'SUCCESS'`, [invoiceId]))[0]!;
const localPaid = (invoiceId: string) => here<{ n: number; paid: number }>(`select count(*) n, coalesce(sum(amount), 0) paid from "Payment" where "invoiceId" = ? and status = 'SUCCESS'`, invoiceId)[0]!;

/** A browser for one side. On fitron.in the cookie banner is answered first, as a visitor would. */
async function page(browser: Browser, baseURL: string, email?: string) {
  const ctx = await browser.newContext({ baseURL, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.addCookies([{ name: "fitron_consent", value: "all", url: baseURL }]);
  if (email) await ctx.addInitScript((k) => localStorage.setItem(k, "1"), `fitron-tour-done-${email}`);
  return ctx.newPage();
}

test.beforeAll(async () => {
  cloudDir = mkdtempSync(path.join(os.tmpdir(), "fitron-sync-cloud-"));
  localDir = mkdtempSync(path.join(os.tmpdir(), "fitron-sync-local-"));
  cloud = await startLocalServer(cloudDir, CLOUD_PORT, { FITRON_EDITION: "", FITRON_DATA_DIR: "", DATABASE_URL: process.env.DATABASE_URL!, AUTH_SECRET: "e2e-sync-auth-secret", BIOMETRIC_KEY: "e2e-sync-biometric-key", STORAGE_DIR: path.join(cloudDir, "storage") });
  link = proxy();
  local = await startLocalServer(localDir, LOCAL_PORT, { FITRON_CLOUD_URL: `http://127.0.0.1:${PROXY_PORT}` });
});

test.afterAll(async () => {
  await local?.stop();
  await cloud?.stop();
  await link?.close();
  rmSync(localDir, { recursive: true, force: true });
  rmSync(cloudDir, { recursive: true, force: true });
});

test("a gym on fitron.in comes down to a new computer whole, with every rupee and paisa the same", async ({ browser }) => {
  cloudPage = await page(browser, cloud.url);
  gym = await signUp(cloudPage, { tag: "sync" });
  await chargeGst(cloudPage);
  await createPlan(cloudPage, { name: "Monthly", months: 1, price: 1500 });
  const memberId = await addMember(cloudPage, "Website Member");
  const invoiceId = await sell(cloudPage, memberId, { payNow: 500 });
  const inv = (await cloudInvoice(invoiceId))!;
  expect(inv.tax).toBeGreaterThan(0);

  localPage = await page(browser, local.url, gym.email);
  await firstRun(localPage, { gym: "Placeholder Gym", name: "Desk", email: "desk@example.in", password: "a-long-password-1" });
  await localPage.goto("/settings/sync");
  await expect(localPage.getByText(/^Not linked\./)).toBeVisible();
  const form = localPage.locator("form", { has: localPage.getByRole("button", { name: "Link and download the gym" }) });
  await form.getByLabel("fitron.in email").fill(gym.email);
  await form.getByLabel("fitron.in password").fill(gym.password);
  await form.getByRole("button", { name: "Link and download the gym" }).click();
  await localPage.waitForURL(/\/login\?/);
  await expect(localPage.getByText(/This computer now holds .* from fitron\.in/)).toBeVisible();
  await localPage.getByLabel("Email").fill(gym.email);
  await localPage.getByLabel("Password").fill(gym.password);
  await localPage.getByRole("button", { name: "Sign in" }).click();
  await localPage.waitForURL(/\/settings\/sync/);
  await expect(localPage.getByText(/Your new recovery key for this computer/)).toBeVisible();

  const [m] = here<{ name: string }>(`select name from "Member" where id = ?`, memberId);
  expect(m?.name).toBe("Website Member");
  const [li] = here<{ number: string; total: number; tax: number }>(`select number, total, tax from "Invoice" where id = ?`, invoiceId);
  expect(li).toEqual({ number: inv.number, total: inv.total, tax: inv.tax });
  expect(localPaid(invoiceId)).toEqual(await cloudPaid(invoiceId));
  await localPage.goto(`/invoices/${invoiceId}`);
  await expect(localPage.getByRole("heading", { name: inv.number })).toBeVisible();
});

test("a change on fitron.in reaches the computer within seconds, and a payment there arrives to the paisa", async () => {
  const [{ id: memberId }] = here<{ id: string }>(`select id from "Member" where name = 'Website Member'`);
  await cloudPage.goto(`/members/${memberId}/edit`);
  await cloudPage.getByLabel("Full name").fill("Website Member Renamed");
  const started = Date.now();
  await cloudPage.getByRole("button", { name: "Save changes" }).click();
  await eventually("the rename on the computer", () => here<{ name: string }>(`select name from "Member" where id = ?`, memberId)[0]?.name === "Website Member Renamed", 30_000);
  test.info().annotations.push({ type: "website → computer", description: `${((Date.now() - started) / 1000).toFixed(1)} s` });

  const [{ id: invoiceId }] = here<{ id: string }>(`select id from "Invoice" where "memberId" = ?`, memberId);
  const before = await cloudPaid(invoiceId);
  await cloudPage.goto(`/invoices/${invoiceId}`);
  await cloudPage.getByLabel("Amount (₹)").fill("250.50");
  await cloudPage.getByRole("button", { name: "Record payment" }).click();
  await eventually("the website's payment on fitron.in", async () => (await cloudPaid(invoiceId)).n === before.n + 1);
  const after = await cloudPaid(invoiceId);
  expect(after.paid - before.paid).toBe(25050);
  await eventually("the payment on the computer", () => localPaid(invoiceId).paid === after.paid, 30_000);
});

test("a sale made on the computer reaches fitron.in, numbered from the computer's own range", async () => {
  await localPage.goto("/dashboard");
  const memberId = await addMember(localPage, "Desk Member");
  const invoiceId = await sell(localPage, memberId, { payNow: 300 });
  const [li] = here<{ number: string; total: number }>(`select number, total from "Invoice" where id = ?`, invoiceId);
  expect(Number(li!.number.replace(/\D/g, ""))).toBeGreaterThan(1_000_000);
  const inv = await eventually("the computer's invoice on fitron.in", () => cloudInvoice(invoiceId), 60_000);
  expect(inv).toMatchObject({ number: li!.number, total: li!.total });
  await eventually("its payment on fitron.in", async () => (await cloudPaid(invoiceId)).paid === 30000);
  expect(await sql(`select 1 from "Member" where id = $1 and name = 'Desk Member'`, [memberId])).toHaveLength(1);
  await cloudPage.goto(`/invoices/${invoiceId}`);
  await expect(cloudPage.getByRole("heading", { name: li!.number })).toBeVisible();
});

test("offline, the desk keeps working; the queue survives a restart, and everything goes up when the connection is back", async () => {
  link.set("cut");
  await localPage.goto("/dashboard");
  const memberId = await addMember(localPage, "Offline Member");
  const invoiceId = await sell(localPage, memberId, { payNow: 200 });
  await eventually("the badge to say offline", async () => {
    await localPage.goto("/dashboard");
    return (await localPage.getByTestId("sync-badge").textContent())?.includes("Offline");
  }, 90_000);
  expect(await sql(`select 1 from "Member" where id = $1`, [memberId])).toHaveLength(0);
  expect(here(`select 1 from "SyncChange" where status = 'PENDING'`).length).toBeGreaterThan(0);

  // FITRON is closed and opened again while still offline: nothing waiting is lost.
  await local.stop();
  local = await startLocalServer(localDir, LOCAL_PORT, { FITRON_CLOUD_URL: `http://127.0.0.1:${PROXY_PORT}` });
  expect(here(`select 1 from "SyncChange" where status = 'PENDING'`).length).toBeGreaterThan(0);
  link.set("on");
  await eventually("the offline sale on fitron.in", async () => (await cloudPaid(invoiceId)).paid === 20000, 150_000);
  expect(await sql(`select 1 from "Member" where id = $1 and name = 'Offline Member'`, [memberId])).toHaveLength(1);
});

test("a connection cut after fitron.in took a payment but before the computer heard back: the retry does not pay twice", async () => {
  await localPage.goto("/login");
  if (!/dashboard|settings/.test(localPage.url())) {
    await localPage.getByLabel("Email").fill(gym.email);
    await localPage.getByLabel("Password").fill(gym.password);
    await localPage.getByRole("button", { name: "Sign in" }).click();
    await localPage.waitForURL(/\/dashboard/);
  }
  const [{ id: invoiceId }] = here<{ id: string }>(`select i.id from "Invoice" i join "Member" m on m.id = i."memberId" where m.name = 'Offline Member'`);
  await eventually("nothing waiting", () => here(`select 1 from "SyncChange" where status = 'PENDING'`).length === 0, 60_000);
  link.set("drop-answers");
  await localPage.goto(`/invoices/${invoiceId}`);
  await localPage.getByLabel("Amount (₹)").fill("100");
  await localPage.getByRole("button", { name: "Record payment" }).click();
  // fitron.in applies the upload; the computer never hears so, and keeps it waiting.
  await eventually("fitron.in to have the payment", async () => (await cloudPaid(invoiceId)).paid === 30000, 60_000);
  expect(here(`select 1 from "SyncChange" where status = 'PENDING'`).length).toBeGreaterThan(0);
  link.set("on");
  await eventually("the computer to hear back", () => here(`select 1 from "SyncChange" where status = 'PENDING'`).length === 0, 150_000);
  expect(await cloudPaid(invoiceId)).toEqual({ n: 2, paid: 30000 });
  expect(localPaid(invoiceId)).toEqual({ n: 2, paid: 30000 });
});

test("the same member changed on both sides while apart: one version stands, both are kept, nothing is lost", async () => {
  const [{ id: memberId }] = here<{ id: string }>(`select id from "Member" where name = 'Desk Member'`);
  link.set("cut");
  await cloudPage.goto(`/members/${memberId}/edit`);
  await cloudPage.getByLabel("Full name").fill("Name From Website");
  await cloudPage.getByRole("button", { name: "Save changes" }).click();
  await cloudPage.waitForURL(new RegExp(`/members/${memberId}$`));
  await localPage.goto(`/members/${memberId}/edit`);
  await localPage.getByLabel("Full name").fill("Name From Computer");
  await localPage.getByRole("button", { name: "Save changes" }).click();
  await localPage.waitForURL(new RegExp(`/members/${memberId}$`));
  link.set("on");
  await eventually("the computer's change on fitron.in", async () => (await sql<{ name: string }>(`select name from "Member" where id = $1`, [memberId]))[0]?.name === "Name From Computer", 150_000);
  const [kept] = here<{ kind: string; fields: string; theirs: string }>(`select kind, fields, theirs from "SyncConflict" where "entityId" = ?`, memberId);
  expect(kept).toMatchObject({ kind: "merged", fields: "name" });
  expect(JSON.parse(kept!.theirs).name).toBe("Name From Website");
  await localPage.goto("/settings/sync");
  await expect(localPage.getByText("Name From Website")).toBeVisible();
  await expect(localPage.getByRole("button", { name: "Keep fitron.in's" })).toBeVisible();
});

test("documents follow their records both ways, a large one in pieces, byte for byte", async () => {
  const [{ id: websiteMember }] = here<{ id: string }>(`select id from "Member" where name = 'Website Member Renamed'`);
  const [{ id: deskMember }] = here<{ id: string }>(`select id from "Member" where name = 'Name From Computer'`);

  // Uploaded on fitron.in, 4 MB: it comes down in two pieces.
  const big = pdf(4 * 1024 * 1024 + 321, "W");
  await uploadDocument(cloudPage, websiteMember, "Website Aadhaar", big);
  const [cloudDoc] = await sql<{ storageKey: string }>(`select "storageKey" from "MemberDocument" where "memberId" = $1 and title = 'Website Aadhaar'`, [websiteMember]);
  const name = cloudDoc!.storageKey.split("/").pop()!;
  const arrived = await eventually("the website's document on the computer", () => filesUnder(localDir).get(name), 120_000);
  expect(readFileSync(arrived).equals(big)).toBe(true);
  await localPage.goto(`/members/${websiteMember}?tab=documents`);
  await expect(localPage.getByText("Website Aadhaar").first()).toBeVisible();

  // Uploaded on the computer: its record goes up first, then the file.
  const small = pdf(20_000, "C");
  await uploadDocument(localPage, deskMember, "Desk Waiver", small);
  const [{ storageKey }] = here<{ storageKey: string }>(`select "storageKey" from "MemberDocument" where "memberId" = ? and title = 'Desk Waiver'`, deskMember);
  const there = path.join(cloudDir, "storage", ...storageKey.split("/"));
  await eventually("the computer's document on fitron.in", () => existsSync(there) && readFileSync(there).length === small.length, 150_000);
  expect(readFileSync(there).equals(small)).toBe(true);
  // Opened on fitron.in by the signed-in owner, as a browser opens it.
  const docId = (await sql<{ id: string }>(`select id from "MemberDocument" where "storageKey" = $1`, [storageKey]))[0]!.id;
  const got = Buffer.from(await cloudPage.evaluate(async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())), `/documents/${docId}`));
  expect(got.equals(small)).toBe(true);
});
