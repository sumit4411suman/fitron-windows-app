import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import pkg from "../package.json";
import { answers, health } from "./desktop/launch";

// npm run desktop:installer-test (Windows): the installer as a customer meets it (Phase 15).
//   install (silent) → program, Start Menu and Desktop shortcuts, Apps & features entry → FITRON starts and makes its data
//   folder → reinstall while FITRON is open (as an update does): FITRON is closed cleanly first, the data is unchanged →
//   FITRON starts again → uninstall: program, shortcuts and entry gone, the data folder and every record still there.
// It uses the real %LOCALAPPDATA%\FITRON, so it runs only where that folder does not exist yet (a clean machine, CI).

const TITLE = "FITRON Gym Accounting";
const root = path.resolve(__dirname, "..");
const setup = path.join(root, "dist", "desktop", `FITRON-Gym-Accounting-Setup-${pkg.version}.exe`);
const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const inst = path.join(local, TITLE);
const data = path.join(local, "FITRON");
const db = path.join(data, "data", "fitron.db");
const uninstallKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${TITLE}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (what: string) => console.log(`  ✓ ${what}`);

async function until<T>(what: string, ms: number, f: () => Promise<T | null | false | undefined> | T | null | false | undefined): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out after ${ms / 1000} s waiting for: ${what}`);
    await sleep(250);
  }
}

const shellLog = () => {
  const f = path.join(data, "logs", "shell.log");
  return existsSync(f) ? readFileSync(f, "utf8") : "";
};
const count = (re: RegExp) => (shellLog().match(re) ?? []).length;

function run(file: string, args: string[]): number {
  const r = spawnSync(file, args, { stdio: "inherit", windowsHide: true, timeout: 10 * 60_000 });
  if (r.error) throw r.error;
  return r.status ?? -1;
}

function program(): string {
  for (const n of ["fitron.exe", `${TITLE}.exe`]) if (existsSync(path.join(inst, n))) return path.join(inst, n);
  throw new Error(`No FITRON program in ${inst}`);
}

function registry(): Record<string, string> | null {
  const r = spawnSync("reg", ["query", uninstallKey], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const out: Record<string, string> = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+REG_\w+\s+(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const startMenu = () => [path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", `${TITLE}.lnk`), path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", TITLE, `${TITLE}.lnk`)].find(existsSync);
const desktopLink = () => path.join(os.homedir(), "Desktop", `${TITLE}.lnk`);

/** Starts the installed FITRON as a customer does: no test settings, its own data folder. */
async function open(n: number): Promise<{ child: ChildProcess; port: number; exited: Promise<number | null> }> {
  const env = { ...process.env };
  delete env.FITRON_DATA_DIR;
  const child = spawn(program(), [], { env, stdio: "ignore" });
  const exited = new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
  const port = await until(`FITRON ready (#${n})`, 240_000, () => {
    if (/start failed/.test(shellLog())) throw new Error(`FITRON could not start:\n${shellLog()}`);
    const all = [...shellLog().matchAll(/ready: FITRON \S+ at http:\/\/127\.0\.0\.1:(\d+)/g)];
    return all.length >= n ? Number(all[n - 1][1]) : null;
  });
  return { child, port, exited };
}

async function close(f: { child: ChildProcess; exited: Promise<number | null> }) {
  execFileSync("taskkill", ["/PID", String(f.child.pid)]);
  if ((await Promise.race([f.exited, sleep(30_000).then(() => "open" as const)])) === "open") throw new Error(`FITRON did not close:\n${shellLog()}`);
}

function records(): { marker: string | null; integrity: string; wal: number } {
  const conn = new Database(db, { readonly: true });
  try {
    const has = conn.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_installer_test'`).get();
    const marker = has ? ((conn.prepare(`SELECT "v" FROM "_installer_test"`).get() as { v: string } | undefined)?.v ?? null) : null;
    const integrity = (conn.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    return { marker, integrity, wal: existsSync(`${db}-wal`) ? statSync(`${db}-wal`).size : 0 };
  } finally {
    conn.close();
  }
}

async function main() {
  if (process.platform !== "win32") throw new Error("The installer test runs on Windows.");
  if (!existsSync(setup)) throw new Error(`No installer at ${setup}. Build it first (docs/local-windows/INSTALLER.md).`);
  if (existsSync(data)) throw new Error(`${data} already exists. This test uses the real FITRON data folder, so it runs only on a clean machine.`);
  console.log(`FITRON installer test\n  installer ${setup}\n  program   ${inst}\n  data      ${data}`);

  // Install.
  if (run(setup, ["/S"]) !== 0) throw new Error("the installer failed");
  for (const f of [program(), path.join(inst, "fitron-node.exe"), path.join(inst, "server", "server.js"), path.join(inst, "uninstall.exe")]) if (!existsSync(f)) throw new Error(`not installed: ${f}`);
  ok(`installed for this user, no administrator needed: ${inst}`);
  if (!startMenu()) throw new Error("no Start Menu shortcut");
  ok(`Start Menu shortcut: ${startMenu()}`);
  if (!existsSync(desktopLink())) throw new Error("no Desktop shortcut (a silent install makes one; /NS leaves it out)");
  ok("Desktop shortcut (optional: a checkbox in the installer)");
  const reg = registry();
  if (!reg || reg.DisplayName !== TITLE || reg.DisplayVersion !== pkg.version || reg.Publisher !== "FITRON" || !reg.UninstallString?.includes("uninstall.exe")) throw new Error(`Apps & features entry: ${JSON.stringify(reg)}`);
  ok(`Apps & features entry: ${reg.DisplayName} ${reg.DisplayVersion}, ${reg.Publisher}`);
  if (existsSync(data)) throw new Error("the installer made the data folder; FITRON makes it when it first starts");

  // First start, as from the Start Menu.
  const first = await open(1);
  const h = await health(first.port);
  if (h?.ok !== true || h.edition !== "local") throw new Error(`health: ${JSON.stringify(h)}`);
  ok(`FITRON starts: ${JSON.stringify({ ok: h.ok, edition: h.edition, version: h.version })}, data folder ${data}`);
  await close(first);
  // A record only this test made, to follow through the update and the uninstall.
  const conn = new Database(db);
  conn.exec(`CREATE TABLE "_installer_test" ("v" TEXT); INSERT INTO "_installer_test" ("v") VALUES ('kept');`);
  conn.close();

  // Reinstall while FITRON is open, as an update does.
  const second = await open(2);
  const stopsBefore = count(/server stopped cleanly/g);
  if (run(setup, ["/S"]) !== 0) throw new Error("the reinstall failed");
  await until("FITRON closed by the installer", 60_000, async () => (await Promise.race([second.exited.then(() => true), sleep(100).then(() => false)])) && !(await answers(second.port)));
  if (count(/server stopped cleanly/g) !== stopsBefore + 1) throw new Error(`the installer did not let FITRON close cleanly:\n${shellLog()}`);
  ok("an update closes FITRON cleanly first (its server wrote everything into fitron.db)");
  const afterUpdate = records();
  if (afterUpdate.marker !== "kept" || afterUpdate.integrity !== "ok" || afterUpdate.wal !== 0) throw new Error(`data after the update: ${JSON.stringify(afterUpdate)}`);
  ok("the data is unchanged by the update (record kept, integrity ok)");
  const third = await open(3);
  if ((await health(third.port))?.ok !== true) throw new Error("FITRON did not start after the update");
  await close(third);
  ok("FITRON starts after the update");

  // Uninstall. Run in place (_?=) so the test waits for it.
  if (run(path.join(inst, "uninstall.exe"), ["/S", `_?=${inst}`]) !== 0) throw new Error("the uninstaller failed");
  for (const f of [path.join(inst, "fitron.exe"), path.join(inst, `${TITLE}.exe`), path.join(inst, "fitron-node.exe"), path.join(inst, "server", "server.js")]) if (existsSync(f)) throw new Error(`still there after uninstall: ${f}`);
  if (startMenu() || existsSync(desktopLink())) throw new Error("a shortcut is left after uninstall");
  if (registry()) throw new Error("the Apps & features entry is left after uninstall");
  ok("uninstall removes the program, its shortcuts and its Apps & features entry");
  const after = records();
  if (after.marker !== "kept" || after.integrity !== "ok") throw new Error(`data after uninstall: ${JSON.stringify(after)}`);
  for (const d of ["data", "backups", "documents", "logs"]) if (!existsSync(path.join(data, d))) throw new Error(`${d} folder removed by uninstall`);
  ok("uninstall keeps the gym's data: fitron.db with every record, backups, documents, logs");
  console.log("\nAll installer checks passed.");
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}\n--- shell.log ---\n${shellLog()}`);
  process.exit(1);
});
