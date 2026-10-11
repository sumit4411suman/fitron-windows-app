import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pkg from "../package.json";
import { answers, changed, health, networkAddresses, snapshot, walSize } from "./desktop/launch";

// npm run desktop:smoke: the real FITRON desktop program, from start to close, as a customer uses it (Phase 14).
//   1. starts, with a fresh data folder;   2. starts its server on 127.0.0.1 and waits for it to be healthy;
//   3. opens FITRON in its window;         4. a second start opens nothing new;
//   5. closing the window stops the server cleanly (WAL written into fitron.db);
//   6. if FITRON itself is ended (a crash, Task Manager), the server stops too; FITRON starts again afterwards;
//   7. it wrote nothing into its program folder, and worked from a data folder named with spaces and non-English letters.
// Build it first: npm run desktop:bundle, then npx tauri build --no-bundle --config src-tauri/tauri.bundle.conf.json
// (or the installer's program). Linux needs a display: xvfb-run -a npm run desktop:smoke.
// --shell <path> picks the program; --shot <file.png> saves a screenshot of the window (Linux).

const root = path.resolve(__dirname, "..");
const TITLE = "FITRON Gym Accounting";
const win = process.platform === "win32";
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const shellPath = path.resolve(opt("--shell") ?? path.join(root, "src-tauri", "target", "release", win ? "fitron.exe" : "fitron"));
const shot = opt("--shot");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (what: string) => console.log(`  ✓ ${what}`);

async function until<T>(what: string, ms: number, f: () => Promise<T | undefined | null | false> | T | undefined | null | false): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out after ${ms / 1000} s waiting for: ${what}`);
    await sleep(250);
  }
}

const shellLog = (dataDir: string) => {
  const f = path.join(dataDir, "logs", "shell.log");
  return existsSync(f) ? readFileSync(f, "utf8") : "";
};

function launch(dataDir: string): { child: ChildProcess; exited: Promise<number | null> } {
  const child = spawn(shellPath, [], { env: { ...process.env, FITRON_DATA_DIR: dataDir }, stdio: "ignore" });
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  return { child, exited };
}

/** Waits for the n-th "ready" line in shell.log and returns its port. */
async function ready(dataDir: string, n: number): Promise<number> {
  return until(`FITRON ready (#${n})`, 240_000, () => {
    const log = shellLog(dataDir);
    if (/start failed/.test(log)) throw new Error(`FITRON could not start:\n${log}`);
    const all = [...log.matchAll(/ready: FITRON \S+ at http:\/\/127\.0\.0\.1:(\d+)/g)];
    return all.length >= n ? Number(all[n - 1][1]) : null;
  });
}

/** The window's own connections to the server (the test's requests close theirs). */
function connectionsTo(port: number): number {
  if (win) {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", `@(Get-NetTCPConnection -LocalPort ${port} -State Established -ErrorAction SilentlyContinue).Count`], { encoding: "utf8" });
    return Number(out.trim()) || 0;
  }
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  let n = 0;
  for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n").slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c[1]?.endsWith(`:${hex}`) && c[3] === "01") n++;
    }
  }
  return n;
}

const x11 = (...a: string[]) => execFileSync("python3", [path.join(__dirname, "desktop", "x11.py"), ...a], { encoding: "utf8" }).trim();

function windowShown(pid: number): boolean {
  if (win) {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).MainWindowTitle`], { encoding: "utf8" });
    return out.trim() === TITLE;
  }
  return x11("names").split("\n").includes(TITLE);
}

/** Closes FITRON's window as a user does: the close button's request, not ending the program. */
function closeWindow(pid: number) {
  if (win) execFileSync("taskkill", ["/PID", String(pid)]);
  else if (x11("close", TITLE) === "0") throw new Error("FITRON's window was not found to close");
}

function endHard(pid: number) {
  if (win) execFileSync("taskkill", ["/F", "/PID", String(pid)]);
  else process.kill(pid, "SIGKILL");
}

async function main() {
  if (!existsSync(shellPath)) throw new Error(`No FITRON program at ${shellPath}. Build it first (see the top of this file).`);
  if (!win && !process.env.DISPLAY) throw new Error("No display. Run: xvfb-run -a npm run desktop:smoke");
  // A data folder like a real Windows user's can be: spaces and letters beyond English in its name (Phase 16).
  const tmp = mkdtempSync(path.join(os.tmpdir(), "fitron-desktop-"));
  const dataDir = path.join(tmp, "Rāhul Sharmā ₹ डेटा", "FITRON");
  mkdirSync(path.dirname(dataDir), { recursive: true });
  // The program folder is read-only for a normal Windows user (Program Files): FITRON writes nothing into it.
  const programDir = path.dirname(shellPath);
  const programBefore = snapshot(programDir);
  console.log(`FITRON desktop smoke test\n  program ${shellPath}\n  data    ${dataDir}`);
  try {
    // 1 to 3: start, server healthy on 127.0.0.1, FITRON in the window.
    const first = launch(dataDir);
    const began = Date.now();
    const port = await ready(dataDir, 1);
    ok(`started; server ready on 127.0.0.1:${port} in ${((Date.now() - began) / 1000).toFixed(1)} s`);
    const h = await health(port);
    if (h?.ok !== true || h.edition !== "local" || h.version !== pkg.version) throw new Error(`health: ${JSON.stringify(h)}`);
    ok(`health: ${JSON.stringify({ ok: h.ok, edition: h.edition, version: h.version })}`);
    for (const d of ["data", "backups", "documents", "logs"]) if (!existsSync(path.join(dataDir, d))) throw new Error(`no ${d} folder`);
    if (!existsSync(path.join(dataDir, "data", "fitron.db"))) throw new Error("no database");
    ok("data folder resolved and made, database created");
    // The installation's secrets: sealed with DPAPI on Windows, never in clear there (Phase 19).
    if (win) {
      if (!existsSync(path.join(dataDir, "secrets.dpapi"))) throw new Error("no secrets.dpapi: the secrets were not sealed");
      if (existsSync(path.join(dataDir, "secrets.json"))) throw new Error("secrets.json in clear beside the sealed secrets");
      if (readFileSync(path.join(dataDir, "secrets.dpapi")).includes("BIOMETRIC_KEY")) throw new Error("secrets.dpapi holds the secrets in clear");
      ok("secrets sealed with DPAPI (secrets.dpapi), no secrets.json in clear");
    } else if (!existsSync(path.join(dataDir, "secrets.json"))) throw new Error("no secrets.json");
    for (const a of networkAddresses()) if (await answers(port, a)) throw new Error(`answers on the network address ${a}`);
    ok(`listens on 127.0.0.1 only (not on ${networkAddresses().join(", ") || "any network address"})`);
    await until("FITRON's window", 30_000, () => windowShown(first.child.pid!));
    await until("the window to load FITRON from the server", 30_000, () => connectionsTo(port) > 0);
    ok("window open, showing FITRON from the server");
    if (shot && !win) {
      await sleep(3_000);
      x11("shot", shot);
      ok(`screenshot ${shot}`);
    }

    // 4: a second start brings the open window forward and starts nothing.
    const second = launch(dataDir);
    const code2 = await Promise.race([second.exited, sleep(20_000).then(() => "running" as const)]);
    if (code2 === "running") throw new Error("a second FITRON kept running");
    if ((shellLog(dataDir).match(/server starting/g) ?? []).length !== 1) throw new Error("a second start started another server");
    if ((await health(port))?.ok !== true) throw new Error("the first FITRON stopped when a second was started");
    ok("a second start opens nothing new");

    // 5: closing the window stops the server cleanly.
    closeWindow(first.child.pid!);
    const code = await Promise.race([first.exited, sleep(30_000).then(() => "running" as const)]);
    if (code === "running") throw new Error(`FITRON did not close:\n${shellLog(dataDir)}`);
    const log = shellLog(dataDir);
    if (!/server stopped cleanly \(exit (status|code): 0\)/.test(log)) throw new Error(`the server did not stop cleanly:\n${log}`);
    if (!/FITRON closed/.test(log)) throw new Error(`no "FITRON closed" in the log:\n${log}`);
    if (await answers(port)) throw new Error("the server still answers after FITRON closed");
    if (walSize(dataDir) !== 0) throw new Error("the WAL was not written into fitron.db");
    ok("closing the window stops the server cleanly (exit 0, WAL written into fitron.db, port closed)");

    // 6: FITRON ended without closing (a crash, Task Manager): the server stops too, and FITRON starts again.
    const third = launch(dataDir);
    const port3 = await ready(dataDir, 2);
    endHard(third.child.pid!);
    await third.exited;
    await until("the server to stop after FITRON was ended", 30_000, async () => !(await answers(port3)));
    ok("if FITRON is ended, its server stops too");
    const fourth = launch(dataDir);
    const port4 = await ready(dataDir, 3);
    if ((await health(port4))?.ok !== true) throw new Error("FITRON did not start again after being ended");
    closeWindow(fourth.child.pid!);
    await Promise.race([fourth.exited, sleep(30_000)]);
    if (await answers(port4)) throw new Error("the server still answers after FITRON closed");
    ok("FITRON starts again after being ended, and closes cleanly");
    const wrote = changed(programBefore, snapshot(programDir));
    if (wrote.length) throw new Error(`FITRON wrote into its program folder: ${wrote.slice(0, 10).join(", ")}`);
    ok("wrote nothing into its program folder; everything went to the data folder");
    console.log("\nAll desktop checks passed.");
  } catch (e) {
    console.error(`\n--- shell.log ---\n${shellLog(dataDir)}`);
    const server = path.join(dataDir, "logs", "server.log");
    if (existsSync(server)) console.error(`--- server.log (end) ---\n${readFileSync(server, "utf8").slice(-4000)}`);
    throw e;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
