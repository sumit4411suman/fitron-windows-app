import { describe, expect, it } from "vitest";
import { buildPlan } from "./vercel-build";

describe("buildPlan", () => {
  it("applies migrations on a production build, through DIRECT_URL when there is one", () => {
    expect(buildPlan({ VERCEL_ENV: "production", DIRECT_URL: "postgres://a", DATABASE_URL: "postgres://b" })).toMatchObject({ migrate: true });
    expect(buildPlan({ VERCEL_ENV: "production", DIRECT_URL: "postgres://a", DATABASE_URL: "postgres://b" }).notice).toContain("DIRECT_URL");
  });

  it("falls back to DATABASE_URL, and treats a blank DIRECT_URL as not set", () => {
    const p = buildPlan({ VERCEL_ENV: "production", DIRECT_URL: "  ", DATABASE_URL: "postgres://b" });
    expect(p.migrate).toBe(true);
    expect(p.notice).toContain("DATABASE_URL");
  });

  it("never touches the database from a preview build, even when the address is set", () => {
    const p = buildPlan({ VERCEL_ENV: "preview", DIRECT_URL: "postgres://live", DATABASE_URL: "postgres://live" });
    expect(p.migrate).toBe(false);
    expect(p.notice).toContain("preview");
  });

  it("does nothing when not on Vercel at all (a laptop, the Docker build)", () => {
    expect(buildPlan({ DATABASE_URL: "postgres://x" }).migrate).toBe(false);
    expect(buildPlan({ VERCEL_ENV: "development" }).migrate).toBe(false);
  });

  it("builds anyway, with a loud warning, when production has no database address", () => {
    const p = buildPlan({ VERCEL_ENV: "production" });
    expect(p.migrate).toBe(false);
    expect(p.notice).toMatch(/WARNING/);
    expect(p.notice).toContain("DATABASE_URL");
    expect(buildPlan({ VERCEL_ENV: "production", DIRECT_URL: "", DATABASE_URL: " " }).migrate).toBe(false);
  });
});
