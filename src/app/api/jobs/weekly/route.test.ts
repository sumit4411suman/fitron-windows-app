import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

// Only the doors: the run itself restores every gym's latest backup, which the database tests cover gym by gym.

afterEach(() => vi.unstubAllEnvs());
const call = (url: string, headers: Record<string, string> = {}) => GET(new Request(url, { headers }));

describe("/api/jobs/weekly", () => {
  it("answers 401 without the scheduler's secret, with a wrong one, or when the server has none", async () => {
    vi.stubEnv("CRON_SECRET", "right-secret");
    expect((await call("http://x/api/jobs/weekly")).status).toBe(401);
    expect((await call("http://x/api/jobs/weekly", { authorization: "Bearer wrong-secret" })).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("http://x/api/jobs/weekly", { authorization: "Bearer " })).status).toBe(401);
  });

  it("refuses a day that is not a date, before running anything", async () => {
    vi.stubEnv("CRON_SECRET", "right-secret");
    // 400, not 401: the secret was accepted, and the day was what stopped it.
    const r = await call("http://x/api/jobs/weekly?day=tomorrow", { authorization: "Bearer right-secret" });
    expect(r.status).toBe(400);
  });
});
