import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOT_IN_LOCAL } from "@/lib/public-paths";
import { config } from "@/proxy";
import { notInLocal } from "./not-in-local";

// src/proxy.ts closes NOT_IN_LOCAL on FITRON for Windows, but its matcher skips the machine routes (webhooks, door
// devices, the AI Trainer's APIs, Google sign-in). Each of those handlers must close itself on Local.
const APP = path.join(__dirname, "../../app");
const skipped = (config.matcher[0]!.match(/\(\?!(.*)\)\.\*\)$/)?.[1] ?? "").split("|").map((p) => p.replace(/\/$/, ""));

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routes(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

afterEach(() => vi.unstubAllEnvs());

describe("routes the proxy does not see, on FITRON for Windows", () => {
  const closed = routes(APP)
    .map((f) => ({ f, url: path.relative(APP, path.dirname(f)).split(path.sep).filter((s) => !s.startsWith("(")).join("/") }))
    .filter(({ url }) => skipped.some((s) => url === s || url.startsWith(`${s}/`)))
    .filter(({ url }) => NOT_IN_LOCAL.some((p) => url === p || url.startsWith(`${p}/`)) || url.startsWith("auth/"));

  it("finds them", () => {
    expect(closed.length).toBeGreaterThan(20);
    expect(closed.map((c) => c.url)).toEqual(expect.arrayContaining(["api/webhooks/razorpay", "api/trainer/pay", "iclock/cdata", "auth/google", "api/assistant"]));
  });

  it("every handler in them closes itself first on Local", () => {
    const open: string[] = [];
    for (const { f, url } of closed) {
      const src = readFileSync(f, "utf8");
      const handlers = [...src.matchAll(/^export (?:async )?function (GET|POST|PUT|DELETE|PATCH)\([^\n]*\{\n(.*)\n/gm)];
      expect(handlers.length, url).toBeGreaterThan(0);
      for (const [, method, first] of handlers) if (!/notInLocal\(\)/.test(first!) && !/notInLocal\(\)/.test(src.split(`function ${method}(`)[1]!.split("\n").slice(1, 4).join("\n"))) open.push(`${method} /${url}`);
    }
    expect(open).toEqual([]);
  });

  it("answers 404 on Local and nothing on the Cloud Edition", async () => {
    vi.stubEnv("FITRON_EDITION", "local");
    vi.stubEnv("FITRON_LOCAL_ALLOW_SIGNUP", "");
    const r = notInLocal()!;
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Not part of FITRON Gym Accounting for Windows." });
    vi.stubEnv("FITRON_EDITION", "cloud");
    expect(notInLocal()).toBeNull();
  });
});
