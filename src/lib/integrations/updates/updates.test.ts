import { afterEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ up: true }));
vi.mock("../online", async (importOriginal) => ({ ...(await importOriginal<typeof import("../online")>()), probablyOnline: vi.fn(async () => net.up) }));
const urls: string[] = [];
let answer: { status: number; json: unknown } = { status: 200, json: { version: "1.1.0", notes: "Faster reports.", pub_date: "2026-11-01T00:00:00Z" } };
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(answer.json), { status: answer.status });
  }),
);

import { latestRelease, updateQueryString } from ".";

const q = { edition: "local", version: "1.0.0", channel: "stable", platform: "windows-x86_64" };

afterEach(() => {
  vi.unstubAllEnvs();
  urls.length = 0;
  net.up = true;
  answer = { status: 200, json: { version: "1.1.0", notes: "Faster reports.", pub_date: "2026-11-01T00:00:00Z" } };
});

describe("the update feed hears the version, never the gym", () => {
  it("asks with the edition, version, channel and platform only", async () => {
    expect(updateQueryString(q)).toBe("edition=local&version=1.0.0&channel=stable&platform=windows-x86_64");
    expect(() => updateQueryString({ ...q, gym: "Iron Gym" })).toThrow(/^Not sent to the update feed: gym/);
    expect(() => updateQueryString({ ...q, version: "1.0.0 members=5000" })).toThrow("version as a short code");
    vi.stubEnv("FITRON_UPDATE_URL", "https://updates.example.com/fitron/latest.json");
    expect(await latestRelease(q)).toEqual({ ok: true, data: { version: "1.1.0", notes: "Faster reports.", publishedAt: "2026-11-01T00:00:00Z" } });
    expect(urls).toEqual(["https://updates.example.com/fitron/latest.json?edition=local&version=1.0.0&channel=stable&platform=windows-x86_64"]);
  });

  it("not set up, offline or a broken feed: an answer for the screen, never an error page", async () => {
    expect(await latestRelease(q)).toMatchObject({ ok: false, reason: "not-configured" });
    vi.stubEnv("FITRON_UPDATE_URL", "https://updates.example.com/latest.json");
    net.up = false;
    expect(await latestRelease(q)).toMatchObject({ ok: false, reason: "offline", message: expect.stringMatching(/^Checking for FITRON updates requires an internet connection\./) });
    expect(urls).toEqual([]);
    net.up = true;
    answer = { status: 200, json: { notes: "no version" } };
    expect(await latestRelease(q)).toEqual({ ok: false, reason: "refused", message: "The update feed did not name a version." });
    answer = { status: 500, json: {} };
    expect(await latestRelease(q)).toMatchObject({ ok: false, reason: "refused" });
  });
});
