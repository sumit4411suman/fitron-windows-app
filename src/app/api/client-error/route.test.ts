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

// The limiter is shared by the process, so each test comes from its own address.
const post = (body: unknown, ip = `10.0.0.${++n}`, raw?: string) =>
  POST(new Request("http://x/api/client-error", { method: "POST", headers: { "x-forwarded-for": ip, "user-agent": "TestBrowser/1.0" }, body: raw ?? JSON.stringify(body) }));

describe("POST /api/client-error", () => {
  it("writes one log line and answers 204", async () => {
    const r = await post({ where: "app", message: "Cannot read x", digest: "abc123", path: "/members/9?token=SECRET" });
    expect(r.status).toBe(204);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toMatchObject({ level: "warn", event: "client.error", where: "app", message: "Cannot read x", digest: "abc123", path: "/members/9", userAgent: "TestBrowser/1.0" });
    expect(out[0]).not.toContain("SECRET");
  });

  it("keeps what it logs short and of the expected kind", async () => {
    await post({ where: "<script>", message: "m".repeat(1000), digest: "d".repeat(500), path: "/".repeat(900), extra: "ignored" });
    const l = JSON.parse(out[0]!);
    expect(l.where).toBe("page");
    expect(l.message.length).toBeLessThan(310);
    expect(l.digest).toHaveLength(64);
    expect(l.path.length).toBeLessThanOrEqual(200);
    expect(l.extra).toBeUndefined();
  });

  it("ignores values that are not text", async () => {
    expect((await post({ message: { a: 1 }, digest: 5, path: [] })).status).toBe(204);
    expect(JSON.parse(out[0]!).message).toBeUndefined();
  });

  it("refuses what is not JSON, and what is too big", async () => {
    expect((await post(null, undefined, "not json")).status).toBe(400);
    expect((await post(null, undefined, "[1,2]")).status).toBe(204);
    expect((await post(null, undefined, JSON.stringify({ message: "x".repeat(5000) }))).status).toBe(413);
  });

  it("allows 20 reports per address in ten minutes, then 429, without writing more lines", async () => {
    const ip = "10.9.9.9";
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await post({ message: "x" }, ip)).status);
    expect(codes.filter((c) => c === 204)).toHaveLength(20);
    expect(codes.slice(20)).toEqual([429, 429]);
    expect(out).toHaveLength(20);
    expect((await post({ message: "x" }, "10.9.9.10")).status).toBe(204);
  });
});
