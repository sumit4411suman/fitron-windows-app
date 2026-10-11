import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// The packaged FITRON server, started the way the desktop shell starts it (src-tauri/src/server.rs): the Node.js runtime
// shipped with FITRON, server.js in the server folder, the Local Edition's variables, 127.0.0.1 and a free port, and
// standard input held open until FITRON closes. Used by npm run desktop:bundle and npm run desktop:smoke.

/** Same list as removed_variable() in src-tauri/src/server.rs. */
export const removedVariable = (name: string) => {
  const n = name.toUpperCase();
  return n.startsWith("FITRON_") || n.startsWith("NODE_OPTIONS") || n === "NODE_PATH" || n === "NODE_ENV" || n.startsWith("NEXT_") || n.startsWith("__NEXT") || ["DATABASE_URL", "STORAGE_DIR", "PORT", "HOSTNAME", "CSP_MODE"].includes(n);
};

export function serverEnv(o: { serverDir: string; dataDir: string; port: number; instance: string }, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) if (!removedVariable(k)) env[k] = v;
  return {
    ...env,
    FITRON_EDITION: "local",
    FITRON_SHELL: "1",
    FITRON_INSTANCE: o.instance,
    FITRON_DATA_DIR: o.dataDir,
    FITRON_MIGRATIONS_DIR: path.join(o.serverDir, "prisma", "local-migrations"),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    CSP_MODE: "enforce",
    HOSTNAME: "127.0.0.1",
    PORT: String(o.port),
  };
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

export type Answer = { status: number; body: string };

/** One request to 127.0.0.1, with any Host header (to try what a website pointed at 127.0.0.1 would send). */
export function ask(port: number, p: string, host = `127.0.0.1:${port}`): Promise<Answer> {
  return new Promise((resolve, reject) => {
    // No kept-alive connection: the smoke test counts the window's own connections to the server.
    const req = http.request({ host: "127.0.0.1", port, path: p, headers: { host }, timeout: 5_000, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

export async function health(port: number): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse((await ask(port, "/api/health")).body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const answers = (port: number, address = "127.0.0.1") =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ host: address, port, timeout: 1_000 });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    s.once("timeout", () => (s.destroy(), resolve(false)));
  });

/** This computer's own network addresses (not 127.x): FITRON must not answer on any of them. */
export const networkAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => !!a && !a.internal && a.family === "IPv4")
    .map((a) => a.address);

export type Sidecar = { child: ChildProcess; port: number; instance: string; output: () => string; exited: Promise<number | null> };

export async function startSidecar(o: { node: string; serverDir: string; dataDir: string; timeoutMs?: number }): Promise<Sidecar & { version: string }> {
  const port = await freePort();
  const instance = randomBytes(16).toString("hex");
  const child = spawn(o.node, [path.join(o.serverDir, "server.js")], { cwd: o.serverDir, env: serverEnv({ serverDir: o.serverDir, dataDir: o.dataDir, port, instance }), stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (b) => (out += String(b)));
  child.stderr?.on("data", (b) => (out += String(b)));
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  const until = Date.now() + (o.timeoutMs ?? 120_000);
  for (;;) {
    const h = await health(port);
    if (h?.ok === true && h.instance === instance) return { child, port, instance, output: () => out, exited, version: String(h.version) };
    if (child.exitCode !== null) throw new Error(`The server stopped while starting (exit ${child.exitCode}):\n${out}`);
    if (Date.now() > until) {
      child.kill();
      throw new Error(`The server did not become ready:\n${out}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** What FITRON does when it closes: let go of the server's standard input, and wait. */
export async function closeStdin(s: Sidecar, waitMs = 15_000): Promise<number | null> {
  s.child.stdin?.end();
  const timer = new Promise<"late">((r) => setTimeout(() => r("late"), waitMs).unref());
  const r = await Promise.race([s.exited, timer]);
  if (r === "late") {
    s.child.kill("SIGKILL");
    throw new Error(`The server did not stop within ${waitMs / 1000} s of FITRON closing:\n${s.output()}`);
  }
  return r;
}

/** Every file under a folder with its size and time, to show the server wrote nothing into its program folder. */
export function snapshot(dir: string, rel = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) for (const [k, v] of snapshot(dir, r)) out.set(k, v);
    else if (e.isFile()) {
      const st = statSync(path.join(dir, r));
      out.set(r, `${st.size}:${st.mtimeMs}`);
    }
  }
  return out;
}

export function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
}

export const walSize = (dataDir: string) => {
  const f = path.join(dataDir, "data", "fitron.db-wal");
  return existsSync(f) ? statSync(f).size : 0;
};
