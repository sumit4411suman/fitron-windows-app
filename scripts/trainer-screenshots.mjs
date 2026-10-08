// Takes the app screenshots on /ai-personal-trainer (public/site/trainer/*.webp): the AI Trainer demo
// (public/site/coach-demo.html), signed in as its made-up member, opened on each screen listed below.
//
//   node scripts/trainer-screenshots.mjs
//
// Run it after scripts/build-coach-demo.py changes the demo. Each picture is a phone screen (390 x 844 CSS px) drawn at 2x and
// saved 540 px wide as WebP. The list of screens, with their captions, is SCREENSHOTS in src/lib/domain/trainer-page.ts, so the
// page and the pictures cannot disagree. Uses Playwright and sharp, like scripts/coach-demo-poster.mjs.
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const outDir = path.join(pub, "site", "trainer");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

// The screens, read from the page's own list ({ id: "home", screen: "home", ... }).
const source = await readFile(path.join(root, "src", "lib", "domain", "trainer-page.ts"), "utf8");
const list = source.slice(source.indexOf("export const SCREENSHOTS"));
const shots = [...list.slice(0, list.indexOf("] as const")).matchAll(/id: "([a-z-]+)", screen: "([a-zA-Z]+)"(?:, ask: "([^"]+)")?(?:, theme: "([a-z]+)")?/g)].map(([, id, screen, ask, theme]) => ({
  id,
  screen,
  ask,
  theme,
}));
if (!shots.length) throw new Error("no SCREENSHOTS found in trainer-page.ts");

// public/ on a local port, as the website serves it.
const server = createServer(async (req, res) => {
  const file = path.join(pub, decodeURIComponent(new URL(req.url, "http://x").pathname));
  try {
    if (!file.startsWith(pub) || !(await stat(file)).isFile()) throw new Error("not a file");
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/site/coach-demo.html`;

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  for (const { id, screen, ask, theme } of shots) {
    // A fresh page each time, so nothing one screen does carries over to the next.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    // The demo keeps its look under its own storage name (build-coach-demo.py); the default look is Sunrise.
    if (theme) await page.addInitScript((t) => localStorage.setItem("fitron-demo.look", t), theme);
    // No live coach and no web fonts from elsewhere: the pictures show the app's built-in replies, in the fonts in the file.
    await page.route("**/api/coach/demo", (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"off"}' }));
    await page.route(/fonts\.(googleapis|gstatic)\.com|unpkg\.com|supabase/, (r) => r.abort());
    await page.goto(`${base}#${screen}`);
    await page.waitForFunction(() => document.body.innerText.length > 80, null, { timeout: 30_000 });
    if (ask) {
      const box = page.locator("input.ch-input");
      await box.fill(ask);
      await box.press("Enter");
      // The built-in reply is typed out after a short "thinking" pause.
      const before = await page.evaluate(() => document.body.innerText.length);
      await page.waitForFunction((n) => document.body.innerText.length > n + 200, before, { timeout: 15_000 });
      await page.waitForTimeout(2500);
    }
    await page.evaluate(() => document.fonts.ready.then(() => document.activeElement?.blur()));
    await page.waitForTimeout(800);
    const png = await page.screenshot();
    const out = await sharp(png).resize({ width: 540 }).webp({ quality: 80 }).toBuffer();
    await writeFile(path.join(outDir, `${id}.webp`), out);
    console.log(`public/site/trainer/${id}.webp: ${Math.round(out.length / 1024)} KB`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
