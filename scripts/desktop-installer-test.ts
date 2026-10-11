import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import pkg from "../package.json";
import { answers, changed, health, snapshot } from "./desktop/launch";

// npm run desktop:installer-test (Windows): the installer as a customer meets it (Phase 15).
//   install (silent) → program, Start Menu and Desktop shortcuts, Apps & features entry → FITRON starts and makes its data
//   folder → reinstall while FITRON is open (as an update does): FITRON is closed cleanly first, the data is unchanged →
//   FITRON starts again → it runs from a read-only program folder and asks for no administrator (Phase 16) → uninstall:
//   program, shortcuts and entry gone, the data folder and every record still there.
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

/** icacls, failing loudly: a permission change that did not take is a wrong test, not a passed one. */
function icacls(...args: string[]) {
  const r = spawnSync("icacls", args, { encoding: "utf8", windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`icacls ${args.join(" ")} failed (${r.status}):\n${r.stdout}${r.stderr}`);
}
const permissions = (p: string) => spawnSync("icacls", [p], { encoding: "utf8", windowsHide: true }).stdout;

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

/**
 * What a clean Windows 10/11 gives a program (Phase 23): Windows' own folders on the PATH and the user's folders, nothing
 * a developer or a server installs (no Node.js, npm, PostgreSQL, Docker, Git, Python).
 */
type Env = Record<string, string | undefined>;
function cleanWindowsEnv(): Env {
  const keep = ["SystemRoot", "windir", "SystemDrive", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP", "USERNAME", "USERDOMAIN", "COMPUTERNAME", "HOMEDRIVE", "HOMEPATH", "PATHEXT", "ComSpec", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "PUBLIC", "ALLUSERSPROFILE"];
  const env: Env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  const win = process.env.SystemRoot ?? "C:\\Windows";
  env.PATH = [`${win}\\system32`, win, `${win}\\System32\\Wbem`, `${win}\\System32\\WindowsPowerShell\\v1.0\\`, `${win}\\System32\\OpenSSH\\`].join(";");
  return env;
}

/** Starts the installed FITRON as a customer does: no test settings, its own data folder. */
async function open(n: number, base: Env = process.env): Promise<{ child: ChildProcess; port: number; exited: Promise<number | null> }> {
  const env = { ...base } as NodeJS.ProcessEnv;
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

/**
 * The rights a Windows program asks for, from the manifest inside it. A normal user can run only "asInvoker" (or a
 * program with no level, which is the same). FITRON must never ask for an administrator (Phase 16).
 */
function requestedLevels(file: string): string[] {
  const text = readFileSync(file).toString("latin1");
  return [...text.matchAll(/requestedExecutionLevel[^>]*?level=["'](\w+)["']/g)].map((m) => m[1]);
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
  for (const f of [setup, program(), path.join(inst, "uninstall.exe")]) {
    const levels = requestedLevels(f);
    if (levels.some((l) => l !== "asInvoker")) throw new Error(`${path.basename(f)} asks Windows for ${levels.join(", ")}`);
  }
  ok("the installer, FITRON and its uninstaller ask only for a normal user's rights (asInvoker)");
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
  if (!existsSync(path.join(data, "secrets.dpapi")) || existsSync(path.join(data, "secrets.json"))) throw new Error("the installation's secrets are not sealed (secrets.dpapi) or a plain secrets.json exists");
  ok("the installation's secrets are sealed with DPAPI for this Windows user");
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

  // A clean Windows machine (Phase 23): only Windows on the PATH. First show that nothing a developer installs can be
  // found from there, then FITRON must start and answer as before, on its own bundled runtime.
  const clean = cleanWindowsEnv();
  for (const tool of ["node", "npm", "npx", "psql", "postgres", "docker", "git", "python"]) {
    const found = spawnSync("where", [tool], { env: clean as NodeJS.ProcessEnv, encoding: "utf8", windowsHide: true });
    if (found.status === 0) throw new Error(`the clean environment still finds ${tool}: ${found.stdout.trim()}`);
  }
  const bare = await open(4, clean);
  const bareHealth = await health(bare.port);
  if (bareHealth?.ok !== true || bareHealth.edition !== "local") throw new Error(`FITRON with only Windows on the PATH: ${JSON.stringify(bareHealth)}`);
  await close(bare);
  ok("FITRON starts with only Windows on the PATH: no Node.js, npm, PostgreSQL, Docker, Git or Python (its own runtime is fitron-node.exe)");

  // The program folder with Program Files' permissions: read and run only for this user and for administrators,
  // Windows itself (SYSTEM) kept in full. Set on the folder alone: Windows carries the permissions down to every file
  // and subfolder itself. (With /T, icacls would also strip each file's inherited permissions but drop the (OI)(CI)
  // grants there, which only folders can carry, leaving every file with no permissions at all, so nothing could open
  // FITRON: "spawn EPERM". A "deny" of write rights is no good either: icacls's W and D rights carry SYNCHRONIZE, which
  // every file open needs.) Permissions a file or subfolder holds of its own are taken away too, and the result is
  // checked before FITRON starts, so a failure names the permissions.
  const before = snapshot(inst);
  const me = process.env.USERNAME ?? os.userInfo().username;
  const ADMINISTRATORS = "*S-1-5-32-544";
  const SYSTEM = "*S-1-5-18";
  icacls(inst, "/inheritance:r", "/grant:r", `${me}:(OI)(CI)RX`, "/grant:r", `${ADMINISTRATORS}:(OI)(CI)RX`, "/grant:r", `${SYSTEM}:(OI)(CI)F`);
  icacls(path.join(inst, "*"), "/remove:g", me, "/remove:g", ADMINISTRATORS, "/T", "/C", "/Q");
  try {
    const exe = program();
    const state = () => `--- permissions ---\n${permissions(inst)}${permissions(exe)}`;
    const can = (f: () => void) => { try { f(); return true; } catch { return false; } };
    // Opening for writing changes nothing by itself; creating a file is undone at once.
    const tmp = path.join(inst, "fitron-permission-test.tmp");
    if (!can(() => closeSync(openSync(exe, "r")))) throw new Error(`FITRON is not readable after the permission change\n${state()}`);
    if (can(() => closeSync(openSync(exe, "r+"))) || can(() => { writeFileSync(tmp, ""); rmSync(tmp); })) throw new Error(`the program folder is still writable after the permission change\n${state()}`);
    let fourth: Awaited<ReturnType<typeof open>>;
    try {
      fourth = await open(5);
    } catch (e) {
      throw new Error(`FITRON could not be started from the read-only program folder: ${(e as Error).message}\n${state()}`);
    }
    if ((await health(fourth.port))?.ok !== true) throw new Error("FITRON did not start from a read-only program folder");
    await close(fourth);
  } finally {
    // Back to the folder's normal, inherited permissions.
    icacls(inst, "/reset", "/T", "/C", "/Q");
  }
  const wrote = changed(before, snapshot(inst));
  if (wrote.length) throw new Error(`FITRON wrote into its program folder: ${wrote.slice(0, 10).join(", ")}`);
  ok("FITRON runs from a read-only program folder (read and run only, for administrators too) and writes nothing there");

  // Uninstall, as Apps & features does. The uninstaller copies itself to a temporary folder and returns at once (its
  // "_?=" option, which would keep it in place, cannot be passed through a path with spaces), so wait for it to finish.
  if (run(path.join(inst, "uninstall.exe"), ["/S"]) !== 0) throw new Error("the uninstaller failed");
  await until("the uninstaller to finish", 120_000, () => !existsSync(path.join(inst, "uninstall.exe")) && !registry());
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
