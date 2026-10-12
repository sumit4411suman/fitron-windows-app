// npm run perf:local (Phase 20): builds the performance dataset in a FITRON for Windows data folder with the app's own
// services (perf/seed.perf.ts), then times every daily screen on it with the production build (e2e/perf/perf.spec.ts;
// `npm run build` first). The dataset is kept in .perf/ and reused; --fresh builds it again. Extra arguments go to
// Playwright. Results: .perf/run/perf-results.json.
import { cpSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const fresh = process.argv.includes("--fresh");
const args = process.argv.slice(2).filter((a) => a !== "--fresh");
const base = path.resolve(".perf");
const dataset = path.join(base, "dataset");
const run = path.join(base, "run");

if (fresh || !existsSync(path.join(dataset, "data", "fitron.db"))) {
  rmSync(dataset, { recursive: true, force: true });
  const env = { ...process.env, PERF_ROOT: dataset, FITRON_EDITION: "local", FITRON_DATA_DIR: dataset, DATABASE_URL: `file:${path.join(dataset, "data", "fitron.db")}`, VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" };
  const s = spawnSync(process.execPath, [path.join("node_modules", "vitest", "vitest.mjs"), "run", "--config", "vitest.perf.config.ts"], { stdio: "inherit", env });
  if (s.status !== 0) process.exit(s.status ?? 1);
}
// Each run works on a copy: the timed sale must not change the kept dataset.
rmSync(run, { recursive: true, force: true });
cpSync(dataset, run, { recursive: true });
const r = spawnSync(process.execPath, [path.join("node_modules", "@playwright", "test", "cli.js"), "test", "e2e/perf", ...args], { stdio: "inherit", env: { ...process.env, E2E_PERF: "1", PERF_ROOT: run, E2E_PORT: process.env.E2E_PORT ?? "3398" } });
process.exit(r.status ?? 1);
