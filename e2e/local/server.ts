import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

// A Local Edition server of its own, started the way the desktop shell starts it (Phase 14): the production build,
// FITRON_EDITION=local, a data folder, 127.0.0.1 only, and nothing else. No test-only switches, no shared database.
export type LocalServer = { url: string; dataDir: string; stop: () => Promise<void> };

export async function startLocalServer(dataDir: string, port: number, extra: Record<string, string> = {}): Promise<LocalServer> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    CSP_MODE: "enforce",
    FITRON_EDITION: "local",
    FITRON_DATA_DIR: dataDir,
    ...extra,
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

export type Owner = { gym: string; name: string; email: string; password: string };

/** First-run setup on a fresh Local server, as a customer does it, ending on the dashboard. */
export async function firstRun(page: import("@playwright/test").Page, o: Owner) {
  await page.goto("/setup");
  await page.getByLabel("Gym name").fill(o.gym);
  await page.getByLabel("Mobile number").fill("9876543210");
  await page.getByLabel("Your name").fill(o.name);
  await page.getByLabel("Email").fill(o.email);
  await page.locator('input[name="password"]').fill(o.password);
  await page.locator('input[name="confirm"]').fill(o.password);
  await page.getByRole("button", { name: "Create gym and owner" }).click();
  await page.getByLabel("I have saved the recovery key").check();
  await page.getByRole("link", { name: "Continue to FITRON" }).click();
  await page.waitForURL(/\/onboarding/);
  await page.getByRole("button", { name: "I'll finish this later" }).click();
  await page.waitForURL(/\/dashboard/);
}

export async function localSignIn(page: import("@playwright/test").Page, o: Owner) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(o.email);
  await page.getByLabel("Password").fill(o.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}
