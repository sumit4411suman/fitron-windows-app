// npm run e2e:sync: cloud sync end to end, fitron.in and FITRON for Windows as two servers from one production build
// (`npm run build` first). fitron.in gets a fresh PostgreSQL database of its own each run; the computer a fresh data
// folder (e2e/sync/sync.spec.ts). Extra arguments go to Playwright.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";

const admin = process.env.SYNC_E2E_PG ?? "postgresql://postgres:postgres@localhost:5432/postgres";
const name = "fitron_sync_e2e";
const url = new URL(admin);
url.pathname = `/${name}`;

async function main() {
  const c = new Client({ connectionString: admin });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${name}`);
  await c.end();
  const env = { ...process.env, DATABASE_URL: url.toString() };
  const m = spawnSync(process.execPath, [path.join("node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { stdio: "inherit", env });
  if (m.status !== 0) process.exit(m.status ?? 1);
  const r = spawnSync(process.execPath, [path.join("node_modules", "@playwright", "test", "cli.js"), "test", "e2e/sync", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...env, E2E_SYNC: "1", E2E_PORT: process.env.E2E_PORT ?? "3399" },
  });
  process.exit(r.status ?? 1);
}

void main();
