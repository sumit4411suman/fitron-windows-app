// Runs the unit and database tests against the Local Windows Edition: a fresh SQLite file built by the same migration
// runner the desktop app uses, with FITRON_EDITION=local. Extra arguments go to vitest (`npm run test:local -- members`).
// Works the same on Windows, macOS and Linux (no shell syntax for environment variables).
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateLocal } from "../src/lib/runtime/local-migrate";

const dir = path.join(os.tmpdir(), `fitron-local-test-${process.pid}`);
mkdirSync(dir, { recursive: true });
const file = path.join(dir, "fitron.db");
const r = migrateLocal(file, path.join(process.cwd(), "prisma", "local-migrations"));
console.log(`SQLite test database: ${file} (applied ${r.applied.join(", ")})`);

const run = spawnSync(process.execPath, [path.join("node_modules", "vitest", "vitest.mjs"), "run", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, FITRON_EDITION: "local", DATABASE_URL: `file:${file}`, FITRON_DATA_DIR: dir },
});
rmSync(dir, { recursive: true, force: true });
process.exit(run.status ?? 1);
