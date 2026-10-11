import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pkg from "../package.json";
import { answers, ask, changed, closeStdin, networkAddresses, snapshot, startSidecar, walSize } from "./desktop/launch";

// npm run desktop:bundle: everything the desktop shell (src-tauri) ships besides itself.
//   build/local-server/            the FITRON server: Next.js standalone output, its static files, public files, the
//                                  Local Edition's database migrations
//   src-tauri/binaries/fitron-node-<target>[.exe]
//                                  the Node.js runtime that runs it, the very one that built it, so the native modules
//                                  (better-sqlite3, argon2) match it. The customer never installs Node.js.
// Then it starts that server the way the shell will and checks it (--no-check to skip). Build on the computer type you
// ship for: the Windows installer is built on Windows (docs/local-windows/DESKTOP.md).

const root = path.resolve(__dirname, "..");
const out = path.join(root, "build", "local-server");
const args = new Set(process.argv.slice(2));

function step(s: string) {
  console.log(`\n▸ ${s}`);
}

function rustTarget(): string {
  const v = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = /^host: (\S+)$/m.exec(v)?.[1];
  if (!host) throw new Error("rustc -vV did not name the host target");
  return host;
}

function dirSize(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirSize(p) : e.isFile() ? statSync(p).size : 0;
  }
  return n;
}

function walk(dir: string, f: (p: string) => void) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    f(p);
    if (e.isDirectory() && !e.isSymbolicLink()) walk(p, f);
  }
}

const hasNativeCode = (dir: string) => {
  let found = false;
  walk(dir, (p) => (found ||= p.endsWith(".node")));
  return found;
};

/**
 * Next.js reaches some packages through symbolic links under .next/node_modules (`better-sqlite3-<hash>` →
 * `node_modules/better-sqlite3`). An installer does not carry links, so each becomes real files. A package with native
 * code becomes a one-line package that loads the one real copy: two copies of SQLite in one program break its file
 * locks. Anything else is copied.
 */
function materializeLinks(dir: string, from: string) {
  const links: string[] = [];
  walk(dir, (p) => lstatSync(p).isSymbolicLink() && links.push(p));
  for (const link of links) {
    let target = path.resolve(path.dirname(link), readlinkSync(link));
    // On Windows the links can be junctions, which always name the full path inside .next/standalone.
    if (target.startsWith(from + path.sep)) target = path.join(dir, path.relative(from, target));
    if (!target.startsWith(dir + path.sep)) throw new Error(`${path.relative(dir, link)} points outside the server folder (${target})`);
    rmSync(link);
    if (hasNativeCode(target)) {
      const name = path.relative(path.join(dir, "node_modules"), target).split(path.sep).join("/");
      mkdirSync(link, { recursive: true });
      writeFileSync(path.join(link, "package.json"), JSON.stringify({ name: path.basename(link), main: "index.js" }) + "\n");
      writeFileSync(path.join(link, "index.js"), `module.exports = require(${JSON.stringify(name)});\n`);
    } else {
      cpSync(target, link, { recursive: true });
    }
  }
}

function build() {
  step("Building the server (Next.js standalone)");
  const r = spawnSync(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, FITRON_DESKTOP_BUILD: "1", NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (r.status !== 0) throw new Error("next build failed");
}

function assemble() {
  step(`Assembling ${path.relative(root, out)}`);
  const standalone = path.join(root, ".next", "standalone");
  if (!existsSync(path.join(standalone, "server.js"))) throw new Error(".next/standalone/server.js is missing: was the build made with FITRON_DESKTOP_BUILD=1?");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.dirname(out), { recursive: true });
  cpSync(standalone, out, { recursive: true, verbatimSymlinks: true });
  materializeLinks(out, standalone);
  cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
  // The website (public/site) and the AI Trainer app (public/trainer) are not part of FITRON for Windows.
  cpSync(path.join(root, "public"), path.join(out, "public"), {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(path.join(root, "public"), src).split(path.sep)[0];
      return rel !== "site" && rel !== "trainer";
    },
  });
  cpSync(path.join(root, "prisma", "local-migrations"), path.join(out, "prisma", "local-migrations"), { recursive: true });
  // Only what the server runs from. Next.js copies more (sources, .env files, anything a computed path might reach); a
  // developer's settings, keys and test uploads must never ship.
  const keep = new Set(["server.js", "package.json", ".next", "node_modules", "public", "prisma"]);
  for (const f of readdirSync(out)) if (!keep.has(f)) rmSync(path.join(out, f), { recursive: true, force: true });
  for (const f of readdirSync(path.join(out, "prisma"))) if (f !== "local-migrations") rmSync(path.join(out, "prisma", f), { recursive: true, force: true });
  for (const f of ["site", "trainer"]) rmSync(path.join(out, "public", f), { recursive: true, force: true });
  // Its build cache is not needed to run, and would be written to.
  rmSync(path.join(out, ".next", "cache"), { recursive: true, force: true });
  const left: string[] = [];
  walk(out, (p) => lstatSync(p).isSymbolicLink() && left.push(path.relative(out, p)));
  if (left.length) throw new Error(`Symbolic links left in the server folder: ${left.join(", ")}`);
  for (const need of [
    "server.js",
    path.join(".next", "BUILD_ID"),
    path.join("node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
    path.join("node_modules", "dejavu-fonts-ttf", "ttf", "DejaVuSans.ttf"),
    path.join("prisma", "local-migrations"),
    path.join("public", "fitron-mark.png"),
  ]) {
    if (!existsSync(path.join(out, need))) throw new Error(`The server folder is missing ${need}`);
  }
  writeFileSync(
    path.join(out, "fitron-server.json"),
    JSON.stringify({ version: pkg.version, node: process.version, platform: process.platform, arch: process.arch, builtAt: new Date().toISOString() }, null, 2) + "\n",
  );
  const mb = dirSize(out) / 1024 / 1024;
  console.log(`  ${mb.toFixed(0)} MB`);
  // About 200 MB is expected; much more means the trace picked up something it should not have.
  if (mb > 400) throw new Error(`The server folder is ${mb.toFixed(0)} MB; something was copied in that should not be.`);
}

function runtime(): string {
  const target = rustTarget();
  const name = `fitron-node-${target}${process.platform === "win32" ? ".exe" : ""}`;
  const dest = path.join(root, "src-tauri", "binaries", name);
  step(`Node.js ${process.version} → src-tauri/binaries/${name}`);
  if (!target.includes(process.platform === "win32" ? "windows" : process.platform === "darwin" ? "apple" : "linux")) throw new Error(`Node.js runs on ${process.platform} but Rust builds for ${target}. Build on the computer type you ship for.`);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(process.execPath, dest);
  return dest;
}

/** Starts the packaged server as the shell does and checks what FITRON for Windows promises. */
async function checkServer(node: string, serverDir: string) {
  step("Checking the packaged server, started as the desktop shell starts it");
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "fitron-bundle-"));
  const before = snapshot(serverDir);
  const ok = (what: string) => console.log(`  ✓ ${what}`);
  try {
    const s = await startSidecar({ node, serverDir, dataDir });
    ok(`healthy: FITRON ${s.version} on 127.0.0.1:${s.port}`);
    if (s.version !== pkg.version) throw new Error(`health says version ${s.version}, package.json ${pkg.version}`);
    for (const d of ["data", "backups", "documents", "logs"]) if (!existsSync(path.join(dataDir, d))) throw new Error(`no ${d} folder in the data folder`);
    ok("data folder made: data, backups, documents, logs");

    const setup = await ask(s.port, "/setup");
    if (setup.status !== 200 || !setup.body.includes("Set up FITRON on this computer")) throw new Error(`/setup answered ${setup.status}`);
    ok("first-run setup page");
    const asset = /\/_next\/static\/[^"']+\.js/.exec(setup.body)?.[0];
    if (!asset || (await ask(s.port, asset)).status !== 200) throw new Error(`static file ${asset} is missing`);
    ok("static files");
    if ((await ask(s.port, "/fitron-mark.png")).status !== 200) throw new Error("/fitron-mark.png is missing");
    ok("public files");
    if ((await ask(s.port, "/site/index.html")).status === 200) throw new Error("the website is in the bundle");
    ok("the website is not in it");

    const rebound = await ask(s.port, "/setup", "attacker.example");
    if (rebound.status !== 421) throw new Error(`a request for another website's name answered ${rebound.status}`);
    ok("refuses a website pointed at 127.0.0.1 (421)");
    for (const a of networkAddresses()) if (await answers(s.port, a)) throw new Error(`FITRON answers on the network address ${a}`);
    ok(`not reachable from the network (${networkAddresses().join(", ") || "no network addresses"})`);

    const code = await closeStdin(s);
    if (code !== 0) throw new Error(`exit ${code} after FITRON closed:\n${s.output()}`);
    if (walSize(dataDir) !== 0) throw new Error("the WAL was not written into the database file");
    if (await answers(s.port)) throw new Error("still answering after FITRON closed");
    ok("stops cleanly when FITRON closes (exit 0, WAL written into fitron.db)");
    const diff = changed(before, snapshot(serverDir));
    if (diff.length) throw new Error(`the server wrote into its program folder: ${diff.slice(0, 10).join(", ")}`);
    ok("wrote nothing into its program folder");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!args.has("--no-build")) build();
  assemble();
  const node = runtime();
  if (!args.has("--no-check")) {
    // From a copy somewhere else, as installed: nothing may point back into this build.
    const moved = mkdtempSync(path.join(os.tmpdir(), "fitron-server-"));
    try {
      cpSync(out, moved, { recursive: true });
      await checkServer(node, moved);
    } finally {
      rmSync(moved, { recursive: true, force: true });
    }
  }
  console.log("\nReady for the desktop shell: npx tauri build --config src-tauri/tauri.bundle.conf.json");
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
