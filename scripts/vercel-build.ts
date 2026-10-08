// The build command on Vercel (vercel.json): apply database migrations when the build is for Production, then build.
// "--dry-run" only prints what it would do. The decision lives in src/lib/domain/vercel-build.ts, where it is tested.
import { spawnSync } from "node:child_process";
import { buildPlan } from "../src/lib/domain/vercel-build";

const plan = buildPlan(process.env);
console.log(`[vercel-build] ${plan.notice}`);
if (process.argv.includes("--dry-run")) process.exit(0);

function run(args: string[]) {
  const r = spawnSync("npx", args, { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[vercel-build] "${args.join(" ")}" failed${r.status === null ? "" : ` (exit ${r.status})`}. The build stops here.`);
    process.exit(r.status ?? 1);
  }
}

if (plan.migrate) run(["prisma", "migrate", "deploy"]);
run(["next", "build"]);
