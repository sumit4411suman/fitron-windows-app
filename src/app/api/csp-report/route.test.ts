import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

let out: string[];
let n = 0;
beforeEach(() => {
  out = [];
  vi.stubEnv("NODE_ENV", "production");
  vi.spyOn(console, "warn").mockImplementation((l: unknown) => void out.push(String(l)));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const classic = (over: Record<string, unknown> = {}) => ({ "csp-report": { "document-uri": "https://fitron.in/dashboard?token=SECRET#x", "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example/a.js?k=SECRET", "source-file": "https://fitron.in/_next/static/c.js", "line-number": 12, disposition: "report", ...over } });
// Each test comes from its own address: the limiter is shared by the process.
const post = (body: unknown, ip = `10.1.0.${++n}`, raw?: string) =>
  POST(new Request("http://x/api/csp-report", { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/csp-report" }, body: raw ?? JSON.stringify(body) }));

describe("POST /api/csp-report", () => {
  it("logs one line saying what was blocked, where, and by which rule, without query strings", async () => {
    expect((await post(classic({ "document-uri": "https://fitron.in/members/1?a=SECRET" }))).status).toBe(204);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toMatchObject({ level: "warn", event: "csp.violation", directive: "script-src-elem", blocked: "https://evil.example/a.js", page: "/members/1", source: "https://fitron.in/_next/static/c.js", line: 12, disposition: "report" });
    expect(out[0]).not.toContain("SECRET");
  });

  it("keeps only a keyword for inline, eval and data addresses, never their content", async () => {
    await post(classic({ "blocked-uri": "data:text/html;base64,SECRETDATA", "document-uri": "https://fitron.in/a" }));
    await post(classic({ "blocked-uri": "inline", "document-uri": "https://fitron.in/b" }));
    await post(classic({ "blocked-uri": "eval", "document-uri": "https://fitron.in/c" }));
    expect(out.map((l) => JSON.parse(l).blocked)).toEqual(["data", "inline", "eval"]);
    expect(out.join("")).not.toContain("SECRETDATA");
  });

  it("understands the newer Reporting API format too", async () => {
    await post([{ type: "csp-violation", body: { documentURL: "https://fitron.in/x?q=1", effectiveDirective: "img-src", blockedURL: "https://cdn.example/i.png", lineNumber: 3 } }]);
    expect(JSON.parse(out[0]!)).toMatchObject({ directive: "img-src", blocked: "https://cdn.example/i.png", page: "/x", line: 3 });
  });

  it("logs the same violation on the same page once, however often a browser repeats it", async () => {
    const same = classic({ "document-uri": "https://fitron.in/repeat" });
    for (let i = 0; i < 5; i++) expect((await post(same)).status).toBe(204);
    expect(out).toHaveLength(1);
    await post(classic({ "document-uri": "https://fitron.in/another" }));
    expect(out).toHaveLength(2);
  });

  it("ignores what is not a report, and refuses what is not JSON or is too big", async () => {
    expect((await post({ nothing: true })).status).toBe(204);
    expect((await post(null, undefined, "[]")).status).toBe(204);
    expect(out).toEqual([]);
    expect((await post(null, undefined, "not json")).status).toBe(400);
    expect((await post(null, undefined, JSON.stringify(classic({ "blocked-uri": "x".repeat(9000) })))).status).toBe(413);
  });

  it("allows 60 reports per address in ten minutes, then 429", async () => {
    const ip = "10.7.7.7";
    const codes: number[] = [];
    for (let i = 0; i < 62; i++) codes.push((await post(classic({ "document-uri": `https://fitron.in/p${i}` }), ip)).status);
    expect(codes.filter((c) => c === 204)).toHaveLength(60);
    expect(codes.slice(60)).toEqual([429, 429]);
  });
});
