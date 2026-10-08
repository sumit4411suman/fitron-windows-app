// Turns the home page's two product screenshots from PNG into WebP and points the page at them.
//
//   node scripts/optimise-site-images.mjs
//
// Run it after scripts/import-site.py, which brings the PNGs back. It is safe to run again: with no PNG left it
// only checks that the page points at the WebP files. The console screenshot is exported at 2400 px wide but is
// never shown wider than 668 px, so it is resized to 1400 px (enough for a 2x screen). public/site/og.png stays a
// PNG because social networks read it, and the 12 KB logo ring is not worth converting.
// Uses sharp, which comes with Next.js (npm i -D sharp if it is ever missing).
import { existsSync } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("sharp is not installed. Run: npm i -D sharp");
  process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "site");
const pagePath = path.join(dir, "index.html");
const images = [
  { name: "app-dashboard", maxWidth: 1000 },
  { name: "console-dashboard", maxWidth: 1400 },
];
const kb = (n) => `${Math.round(n / 1024)} KB`;

let html = await readFile(pagePath, "utf8");
for (const { name, maxWidth } of images) {
  const png = path.join(dir, `${name}.png`);
  const webp = path.join(dir, `${name}.webp`);
  if (existsSync(png)) {
    await sharp(png).resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 85, effort: 6 }).toFile(webp);
    console.log(`${name}: ${kb((await stat(png)).size)} PNG -> ${kb((await stat(webp)).size)} WebP`);
    await rm(png);
  } else if (!existsSync(webp)) {
    console.error(`Neither ${name}.png nor ${name}.webp is in public/site.`);
    process.exit(1);
  }
  html = html.replaceAll(`/site/${name}.png`, `/site/${name}.webp`);
}
await writeFile(pagePath, html);
console.log("public/site/index.html points at the WebP files.");
