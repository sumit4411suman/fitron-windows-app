// The end-to-end suite against the Local Windows Edition: a production build (`npm run build` first) started with
// FITRON_EDITION=local on a fresh SQLite file in .local-e2e/. Extra arguments go to Playwright (`npm run e2e:local -- sale`).
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

rmSync(path.join(process.cwd(), ".local-e2e"), { recursive: true, force: true });
const run = spawnSync(process.execPath, [path.join("node_modules", "@playwright", "test", "cli.js"), "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, E2E_EDITION: "local", DATABASE_URL: "file:./.local-e2e/data/fitron.db", E2E_PORT: process.env.E2E_PORT ?? "3200" },
});
process.exit(run.status ?? 1);
