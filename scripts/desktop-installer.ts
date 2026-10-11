import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import pkg from "../package.json";

// After `tauri build`: the Windows installer under the name customers download, FITRON-Gym-Accounting-Setup-<version>.exe,
// with its SHA-256 beside it, in dist/desktop/. Tauri names it "<product>_<version>_x64-setup.exe".

const root = path.resolve(__dirname, "..");
const from = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");
const made = existsSync(from) ? readdirSync(from).filter((f) => f.endsWith("-setup.exe") && f.includes(`_${pkg.version}_`)) : [];
if (made.length !== 1) {
  console.error(`✗ Expected one installer for version ${pkg.version} in ${from}, found ${made.length ? made.join(", ") : "none"}. Run: npx tauri build --config src-tauri/tauri.bundle.conf.json`);
  process.exit(1);
}
const name = `FITRON-Gym-Accounting-Setup-${pkg.version}.exe`;
const out = path.join(root, "dist", "desktop");
mkdirSync(out, { recursive: true });
const dest = path.join(out, name);
copyFileSync(path.join(from, made[0]), dest);
const sha256 = createHash("sha256").update(readFileSync(dest)).digest("hex");
writeFileSync(`${dest}.sha256`, `${sha256}  ${name}\n`);
console.log(`${path.relative(root, dest)}  ${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB\nSHA-256 ${sha256}`);
