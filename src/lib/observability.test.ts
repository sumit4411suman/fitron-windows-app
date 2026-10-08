import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserError } from "@/lib/services/errors";

const sendEmail = vi.hoisted(() => vi.fn<(mail: { to: string; subject: string; text: string }) => Promise<{ sent: true }>>(async () => ({ sent: true })));
vi.mock("@/lib/integrations/email", () => ({ emailReady: () => !!process.env.SMTP_HOST, sendEmail }));

import { AlertThrottle, alertText, describeRequestError, isExpected, reportRequestError, scrub } from "./observability";
import { errorFields, format } from "./log";

const root = path.join(__dirname, "../..");
const req = (over: Partial<{ path: string; method: string; headers: Record<string, string | string[] | undefined> }> = {}) => ({ path: "/members/abc?token=SECRET", method: "GET", headers: {}, ...over });
const ctx = { routerKind: "App Router", routePath: "/members/[id]", routeType: "render", renderSource: "react-server-components" };
const fail = (digest = "d1g3st", message = "boom") => Object.assign(new Error(message), { digest });

describe("log lines", () => {
  it("start with time, level and event, then carry the fields as JSON", () => {
    const line = format("warn", "thing.happened", { a: 1, b: "x", c: true, d: null }, new Date("2026-10-05T10:00:00Z"));
    expect(line).toBe('{"time":"2026-10-05T10:00:00.000Z","level":"warn","event":"thing.happened","a":1,"b":"x","c":true,"d":null}');
  });

  it("leave out fields that look like secrets, reserved names and empty values", () => {
    const o = JSON.parse(format("info", "e", { password: "p", sessionToken: "t", apiKey: "k", Authorization: "a", cookie: "c", time: "no", level: "no", event: "no", gone: undefined, kept: "yes" }));
    expect(Object.keys(o)).toEqual(["time", "level", "event", "kept"]);
    expect(o.level).toBe("info");
  });

  it("keep one long value from making a huge line", () => {
    expect(JSON.parse(format("info", "e", { big: "x".repeat(5000) })).big.length).toBeLessThan(600);
  });
});

describe("what is recorded about an error", () => {
  it("is its kind, message, code, digest and the first stack frames, not the whole object", () => {
    const e = Object.assign(new TypeError("bad"), { code: "P2002", digest: "abc", extra: { secret: "x" } });
    const f = errorFields(e);
    expect(f).toMatchObject({ errorName: "TypeError", errorMessage: "bad", code: "P2002", digest: "abc" });
    expect(Object.keys(f).sort()).toEqual(["code", "digest", "errorMessage", "errorName", "stack"]);
    expect(String(f.stack).split("\n").length).toBeLessThanOrEqual(6);
    expect(String(f.stack).split("\n").every((l) => l.startsWith("at "))).toBe(true);
  });

  it("copes with something that is not an Error", () => {
    expect(errorFields("just a string")).toEqual({ errorName: "NonError", errorMessage: "just a string" });
    expect(errorFields(undefined)).toEqual({ errorName: "NonError", errorMessage: "undefined" });
  });
});

describe("which errors are faults", () => {
  it("does not count a rule shown to the user, a redirect or a not-found as one", () => {
    expect(isExpected(new UserError("Pick a plan."))).toBe(true);
    expect(isExpected(fail("NEXT_REDIRECT;replace;/login;307;"))).toBe(true);
    expect(isExpected(fail("NEXT_HTTP_ERROR_FALLBACK;404"))).toBe(true);
    expect(isExpected(fail("NEXT_NOT_FOUND"))).toBe(true);
  });

  it("counts everything else", () => {
    expect(isExpected(new Error("db is down"))).toBe(false);
    expect(isExpected(fail("1234"))).toBe(false);
    expect(isExpected("a string")).toBe(false);
    expect(isExpected(null)).toBe(false);
  });
});

describe("describing a failed request", () => {
  it("keeps the path but never the query string, which can hold sign-in tokens", () => {
    const f = describeRequestError(fail(), req(), ctx);
    expect(f).toMatchObject({ method: "GET", path: "/members/abc", routePath: "/members/[id]", routeType: "render", digest: "d1g3st" });
    expect(JSON.stringify(f)).not.toContain("SECRET");
  });

  it("takes the request id from the proxy, cleaned up, and copes with it being missing", () => {
    expect(describeRequestError(fail(), req({ headers: { "x-request-id": "3f2a-9c.1_x" } }), ctx).requestId).toBe("3f2a-9c.1_x");
    expect(describeRequestError(fail(), req({ headers: { "x-request-id": ["abc", "def"] } }), ctx).requestId).toBe("abc");
    expect(describeRequestError(fail(), req({ headers: { "x-request-id": 'a"b\n{c}' } }), ctx).requestId).toBe("abc");
    expect(describeRequestError(fail(), req({ headers: { "x-request-id": "x".repeat(300) } }), ctx).requestId).toHaveLength(64);
    expect(describeRequestError(fail(), req(), ctx).requestId).toBeUndefined();
  });

  it("does not record the request's headers or cookies", () => {
    const f = describeRequestError(fail(), req({ headers: { cookie: "fitron_session=SESSION", authorization: "Bearer TOKEN" } }), ctx);
    expect(JSON.stringify(f)).not.toMatch(/SESSION|TOKEN/);
  });
});

describe("scrub", () => {
  it("removes email addresses and long numbers from a message", () => {
    expect(scrub("duplicate key for asha.k+gym@example.co.in and phone 98765 43210, id 7")).toBe("duplicate key for [email] and phone [number], id 7");
  });
});

describe("AlertThrottle", () => {
  const H = 60 * 60_000;

  it("lets the first error of a kind through and holds back the same kind for an hour, counting them", () => {
    const t = new AlertThrottle();
    expect(t.take("a", 0)).toEqual({ skipped: 0 });
    expect(t.take("a", 1000)).toBeNull();
    expect(t.take("a", 2000)).toBeNull();
    expect(t.take("a", H - 1)).toBeNull();
    expect(t.take("a", H + 1)).toEqual({ skipped: 3 });
    expect(t.take("a", H + 2)).toBeNull();
  });

  it("lets a different kind through", () => {
    const t = new AlertThrottle();
    expect(t.take("a", 0)).not.toBeNull();
    expect(t.take("b", 1)).not.toBeNull();
  });

  it("sends no more than ten in an hour whatever the kinds, then starts again", () => {
    const t = new AlertThrottle();
    const sent = Array.from({ length: 25 }, (_, i) => t.take(`k${i}`, i)).filter(Boolean);
    expect(sent).toHaveLength(10);
    expect(t.take("late", H + 5)).not.toBeNull();
  });

  it("does not grow without end", () => {
    const t = new AlertThrottle(H, 1_000_000, 50);
    for (let i = 0; i < 500; i++) t.take(`k${i}`, i);
    expect((t as unknown as { seen: Map<string, unknown> }).seen.size).toBe(50);
  });
});

describe("the alert email", () => {
  const f = { ...describeRequestError(fail("ref-77", "no row for asha@example.com"), req({ headers: { "x-request-id": "rid-1" } }), ctx) };

  it("says what failed and where, with the reference and request id, and how to find it", () => {
    const text = alertText(f, 0, new Date("2026-10-05T10:00:00Z"));
    for (const s of ["GET /members/abc", "route /members/[id], render", "Reference: ref-77", "Request id: rid-1", 'grep "ref-77"', "2026-10-05T10:00:00.000Z"]) expect(text, s).toContain(s);
  });

  it("holds no email address, no query string and no stack", () => {
    const text = alertText(f, 0);
    expect(text).not.toContain("asha@example.com");
    expect(text).toContain("[email]");
    expect(text).not.toContain("SECRET");
    expect(text).not.toMatch(/\bat .*\(.*:\d+/);
  });

  it("says how many like it were held back", () => {
    expect(alertText(f, 4)).toContain("4 more like it since the last email.");
    expect(alertText(f, 0)).not.toContain("more like it");
  });
});

describe("reporting an error nobody caught", () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("ERROR_ALERT_TO", "owner@example.com, second@example.com");
    for (const m of ["error", "warn", "log"] as const) vi.spyOn(console, m).mockImplementation((l: unknown) => void out.push(String(l)));
    sendEmail.mockClear();
    sendEmail.mockResolvedValue({ sent: true });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  // The throttle is shared by the whole process, so each test uses its own route to be a new kind of error.
  let n = 0;
  const run = (e: unknown, over = {}) => reportRequestError(e, req({ headers: { "x-request-id": "rid-9" } }), { ...ctx, routePath: `/r${++n}`, ...over });

  it("writes one line to the log with the digest, request id and path, and no query string", async () => {
    await run(fail("digest-1"));
    const lines = out.map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", event: "request.error", digest: "digest-1", requestId: "rid-9", path: "/members/abc", errorMessage: "boom" });
    expect(out.join("")).not.toContain("SECRET");
  });

  it("emails every address once, and not again for the same kind of error", async () => {
    const e = fail("digest-2");
    const route = { routePath: "/same" };
    await run(e, route);
    await run(e, route);
    await run(e, route);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]![0]).toMatchObject({ to: "owner@example.com,second@example.com", subject: "[FITRON] Error on /same" });
    expect(out.filter((l) => l.includes("request.error"))).toHaveLength(3);
  });

  it("ignores redirects, not-found and rules shown to the user: no log line, no email", async () => {
    for (const e of [new UserError("Pick a plan."), fail("NEXT_REDIRECT;replace;/x;307;"), fail("NEXT_HTTP_ERROR_FALLBACK;404")]) await run(e);
    expect(out).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends no email without ERROR_ALERT_TO, without SMTP, or outside production, but still logs", async () => {
    vi.stubEnv("ERROR_ALERT_TO", "");
    await run(fail("a"));
    vi.stubEnv("ERROR_ALERT_TO", "owner@example.com");
    vi.stubEnv("SMTP_HOST", "");
    await run(fail("b"));
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("NODE_ENV", "development");
    await run(fail("c"));
    expect(sendEmail).not.toHaveBeenCalled();
    expect(out.filter((l) => l.includes("request.error"))).toHaveLength(3);
  });

  it("never throws, even when the email cannot be sent", async () => {
    sendEmail.mockRejectedValue(new Error("smtp down"));
    await expect(run(fail("digest-3"))).resolves.toBeUndefined();
    expect(out.some((l) => l.includes("request.error.alert_failed"))).toBe(true);
  });
});

describe("Next.js hook", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is wired to the reporter on the Node.js server only", async () => {
    const reporter = vi.fn(async () => {});
    vi.doMock("@/lib/observability", () => ({ reportRequestError: reporter }));
    const { onRequestError } = await import("../instrumentation");
    const args = [new Error("x"), req(), ctx] as const;
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await onRequestError(...(args as unknown as Parameters<typeof onRequestError>));
    expect(reporter).not.toHaveBeenCalled();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await onRequestError(...(args as unknown as Parameters<typeof onRequestError>));
    expect(reporter).toHaveBeenCalledTimes(1);
    vi.doUnmock("@/lib/observability");
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (n === "generated" || n === "node_modules") return [];
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe("the source", () => {
  it("writes to the log through src/lib/log.ts only: no console.log, info, warn, error or debug anywhere else", () => {
    const bad = sourceFiles(path.join(root, "src"))
      .filter((f) => !f.endsWith(path.join("lib", "log.ts")))
      .filter((f) => /\bconsole\.(log|info|warn|error|debug)\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(bad).toEqual([]);
  });

  it("has an error page for the console, one for the website and a last resort, each a client component that takes retry", () => {
    for (const f of ["src/app/error.tsx", "src/app/(app)/error.tsx", "src/app/global-error.tsx"]) {
      const s = readFileSync(path.join(root, f), "utf8");
      expect(s.startsWith('"use client"'), `${f} is a client component`).toBe(true);
      expect(/\bretry\b/.test(s), `${f} uses retry`).toBe(true);
    }
    expect(readFileSync(path.join(root, "src/app/global-error.tsx"), "utf8")).toContain("<html");
  });

  it("has a not-found page for the website and one for the console", () => {
    for (const f of ["src/app/not-found.tsx", "src/app/(app)/not-found.tsx"]) expect(readFileSync(path.join(root, f), "utf8")).toContain("export default function NotFound");
  });
});

describe("deployment", () => {
  it("gives every request an id in Caddy, passes it on to the app and returns it to the browser", () => {
    const c = readFileSync(path.join(root, "deploy/Caddyfile"), "utf8");
    expect(c).toContain("request_header X-Request-Id {http.request.uuid}");
    expect(c).toContain("header X-Request-Id {http.request.uuid}");
  });

  it("documents ERROR_ALERT_TO and the installer sets it to the admin email", () => {
    expect(readFileSync(path.join(root, ".env.example"), "utf8")).toContain("ERROR_ALERT_TO=");
    expect(readFileSync(path.join(root, "deploy/install.sh"), "utf8")).toContain('set_env ERROR_ALERT_TO "$ADMIN"');
  });
});
