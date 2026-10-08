// Takes the picture the home page shows on the AI Coach card until a visitor presses "Chat with the AI coach"
// (public/site/coach-demo.webp): the demo itself (public/site/coach-demo.html), signed in as its made-up member, after the
// coach has answered "Give me a legs workout" from the app's built-in replies.
//
//   node scripts/coach-demo-poster.mjs
//
// Run it after scripts/build-coach-demo.py changes the demo. The picture is the size of the phone screen on the card (the
// frame there is 392 px wide and about 770 px tall), drawn at 2x and saved at 560 px wide as WebP. Uses Playwright and
// sharp (both are dev dependencies; Playwright's Chromium is the one `npx playwright install chromium` fetches).
import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json" };

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
const url = `http://127.0.0.1:${server.address().port}/site/coach-demo.html`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  const page = await browser.newPage({ viewport: { width: 392, height: 770 }, deviceScaleFactor: 2 });
  // No live coach and no web fonts from elsewhere: the picture shows the app's built-in reply, in the fonts in the file.
  await page.route("**/api/coach/demo", (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"off"}' }));
  await page.route(/fonts\.(googleapis|gstatic)\.com|unpkg\.com/, (r) => r.abort());
  await page.goto(url);
  await page.waitForFunction(() => document.body.innerText.length > 80, null, { timeout: 30_000 });
  const box = page.locator("input.ch-input");
  await box.fill("Give me a legs workout");
  await box.press("Enter");
  await page.getByText("Back Squat").waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => document.activeElement?.blur()));
  await page.waitForTimeout(600);
  const png = await page.screenshot();
  const out = await sharp(png).resize({ width: 560 }).webp({ quality: 82 }).toBuffer();
  await writeFile(path.join(pub, "site", "coach-demo.webp"), out);
  console.log(`public/site/coach-demo.webp: ${Math.round(out.length / 1024)} KB`);
} finally {
  await browser.close();
  server.close();
}
