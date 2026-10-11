import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pkg from "../package.json";
import { installerName, updateFeed } from "./desktop/update-feed";

// npm run desktop:release: what FITRON uploads for a release (docs/local-windows/UPDATES.md), in dist/desktop/:
//   FITRON-Gym-Accounting-Setup-<version>.exe         the installer customers download
//   FITRON-Gym-Accounting-Setup-<version>.exe.sha256  its checksum
//   latest.json                                       the update feed: version, notes, the installer's address and
//                                                     FITRON's signature over it (from the .sig the build made)
// Run after a release build, on Windows:
//   FITRON_UPDATE_URL=https://…/latest.json FITRON_UPDATE_PUBKEY=… TAURI_SIGNING_PRIVATE_KEY=… \
//   npx tauri build --config src-tauri/tauri.bundle.conf.json --config src-tauri/tauri.release.conf.json
//   npm run desktop:release -- --notes-file RELEASE-NOTES.md

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function main() {
  const feedUrl = process.env.FITRON_UPDATE_URL;
  if (!feedUrl) throw new Error("FITRON_UPDATE_URL is not set: the same address the release was built with (…/latest.json).");
  const bundle = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");
  const made = existsSync(bundle) ? readdirSync(bundle).filter((f) => f.endsWith("-setup.exe") && f.includes(`_${pkg.version}_`)) : [];
  if (made.length !== 1) throw new Error(`Expected one installer for version ${pkg.version} in ${bundle}, found ${made.length ? made.join(", ") : "none"}.`);
  const sig = path.join(bundle, `${made[0]}.sig`);
  if (!existsSync(sig)) throw new Error(`No signature beside the installer (${sig}). Build with src-tauri/tauri.release.conf.json and TAURI_SIGNING_PRIVATE_KEY set.`);
  const notesFile = opt("--notes-file");
  const notes = notesFile ? readFileSync(notesFile, "utf8") : (opt("--notes") ?? "");

  const out = path.join(root, "dist", "desktop");
  mkdirSync(out, { recursive: true });
  const name = installerName(pkg.version);
  const dest = path.join(out, name);
  copyFileSync(path.join(bundle, made[0]), dest);
  const bytes = readFileSync(dest);
  writeFileSync(`${dest}.sha256`, `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
  const feed = updateFeed({ version: pkg.version, notes, feedUrl, signature: readFileSync(sig, "utf8"), date: new Date() });
  writeFileSync(path.join(out, "latest.json"), JSON.stringify(feed, null, 2) + "\n");
  console.log(`dist/desktop/${name}  ${(bytes.length / 1024 / 1024).toFixed(1)} MB\ndist/desktop/latest.json → ${feed.platforms["windows-x86_64"].url}\nUpload both, and the .sha256, to where ${feedUrl} is served.`);
}

try {
  main();
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
