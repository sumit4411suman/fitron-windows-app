import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

// A Local Edition server of its own, started the way the desktop shell starts it (Phase 14): the production build,
// FITRON_EDITION=local, a data folder, 127.0.0.1 only, and nothing else. No test-only switches, no shared database.
export type LocalServer = { url: string; dataDir: string; stop: () => Promise<void> };

export async function startLocalServer(dataDir: string, port: number): Promise<LocalServer> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    CSP_MODE: "enforce",
    FITRON_EDITION: "local",
    FITRON_DATA_DIR: dataDir,
  };
  const child: ChildProcess = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (b) => (output += String(b)));
  child.stderr?.on("data", (b) => (output += String(b)));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok && ((await r.json()) as { ok: boolean }).ok) break;
    } catch {
      // not listening yet
    }
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Local server did not start:\n${output}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    url,
    dataDir,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}
