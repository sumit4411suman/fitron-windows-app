// Phase 7 of the Local Windows Edition: the tests of each module, run one module at a time on a fresh SQLite file, in
// the order the modules were migrated. Prints one line per module. `npx tsx scripts/local-module-check.ts`.
import { spawnSync } from "node:child_process";

export const MODULES: [string, string[]][] = [
  ["1 Members", ["members.db", "frontdesk.db", "privacy.db", "documents.db", "validation"]],
  ["2 Memberships", ["membership", "freeze", "offers", "billing.db", "local-vertical-slice"]],
  ["3 Payments", ["billing.db", "financial-guard", "local-vertical-slice"]],
  ["4 Invoices", ["domain/billing", "billing.db", "exports.db"]],
  ["5 Expenses", ["accounting.db", "payroll"]],
  ["6 Accounting / Ledger", ["accounting.db", "accounting-close", "domain/periods"]],
  ["7 GST", ["domain/tax", "domain/billing", "reports-center"]],
  ["8 Attendance", ["frontdesk.db", "self-checkin", "domain/access"]],
  ["9 Reports", ["reports-center", "reports.test", "dashboard.db"]],
  ["10 POS / Inventory", ["frontdesk.db", "assets.db"]],
  ["11 Assets", ["assets"]],
  ["12 Audit Logs", ["audit"]],
  ["13 Settings", ["settings", "staff.db", "branches.db", "go-live", "onboarding"]],
];

for (const [name, filters] of MODULES) {
  const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/test-local.ts", ...filters], { encoding: "utf8" });
  const out = `${r.stdout}${r.stderr}`;
  const files = out.match(/Test Files\s+(.*)/)?.[1]?.trim() ?? "?";
  const tests = out.match(/Tests\s+(.*)/)?.[1]?.trim() ?? "?";
  console.log(`${r.status === 0 ? "PASS" : "FAIL"}  ${name.padEnd(24)} files: ${files.padEnd(28)} tests: ${tests}`);
}
