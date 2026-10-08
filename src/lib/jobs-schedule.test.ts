import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), "utf8");

// The Docker server's scheduler (deploy/scheduler.sh) and the GitHub workflow used when hosting on Vercel
// (.github/workflows/jobs.yml) must call the same jobs, or a job quietly stops running on one of them.
describe("scheduled jobs", () => {
  const workflow = read(".github/workflows/jobs.yml");
  const dockerJobs = [...new Set([...read("deploy/scheduler.sh").matchAll(/\/api\/jobs\/([a-z]+)/g)].map((m) => m[1]!))].sort();
  // Lines like:  daily|"0 1 * * *") job=daily ;;
  const cases = [...workflow.matchAll(/^\s+([a-z]+)\|"([^"]+)"\) job=([a-z]+) ;;$/gm)].map((m) => ({ name: m[1]!, cron: m[2]!, job: m[3]! }));
  const scheduled = [...workflow.matchAll(/^\s+- cron: "([^"]+)"$/gm)].map((m) => m[1]!);

  it("finds the jobs it is meant to compare", () => {
    expect(dockerJobs.length).toBeGreaterThanOrEqual(4);
    expect(cases.length).toBe(dockerJobs.length);
  });

  it("the workflow runs exactly the jobs the Docker scheduler runs", () => {
    expect(cases.map((c) => c.job).sort()).toEqual(dockerJobs);
  });

  it("each case answers to its own name and to its own schedule", () => {
    for (const c of cases) expect(c.name).toBe(c.job);
    expect([...scheduled].sort()).toEqual(cases.map((c) => c.cron).sort());
  });

  it("every job has a route to call", () => {
    for (const j of dockerJobs) expect(existsSync(path.resolve(process.cwd(), `src/app/api/jobs/${j}/route.ts`)), `no route for ${j}`).toBe(true);
  });
});

describe("vercel.json", () => {
  const config = JSON.parse(read("vercel.json")) as { buildCommand?: string; regions?: string[] };

  it("builds through a script that exists", () => {
    const script = config.buildCommand?.match(/^npm run (\S+)$/)?.[1];
    expect(script, "buildCommand should be 'npm run <script>'").toBeTruthy();
    expect(JSON.parse(read("package.json")).scripts[script!]).toBeTruthy();
  });

  it("names exactly one region, which must be the one the database is in", () => {
    expect(config.regions).toHaveLength(1);
  });
});
